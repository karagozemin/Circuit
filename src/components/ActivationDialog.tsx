import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleAlert, ExternalLink, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react'
import type { Hex } from 'viem'
import type { StrategyManifest } from '../lib/strategy'
import type { TradingMarketSnapshot } from '../lib/dreamdex/discovery'
import type { WalletSnapshot } from '../lib/wallet'
import { walletErrorMessage } from '../lib/wallet'
import type { ActivationPreflight, TransactionUpdate } from '../lib/contracts/activation'
import { ExplorerLink, Modal } from './experience/shared'

type ActivityKind = 'system' | 'trade' | 'reactivity' | 'success'

interface ActivationDialogProps {
  open: boolean
  manifest: StrategyManifest
  market: TradingMarketSnapshot
  wallet: WalletSnapshot
  onClose: () => void
  onActivity: (title: string, detail: string, kind: ActivityKind, hash?: Hex) => void
  onActivated: (strategyId: Hex, subscriptionId: bigint, details: {subscriptions:bigint[];blockNumber:bigint}) => void
}

const activationSteps = [
  { key: 'creating', label: 'Create strategy' },
  { key: 'configuring', label: 'Link smart account' },
  { key: 'binding', label: 'Bind live market' },
  { key: 'rollover', label: 'Authorize rollover' },
  { key: 'subscribing-fill', label: 'Subscribe to trades' },
  { key: 'subscribing-resolution', label: 'Subscribe to results' },
  { key: 'subscribing-successor', label: 'Subscribe to next markets' },
  { key: 'activating', label: 'Activate strategy' },
] as const

type Progress = 'idle' | 'preparing' | 'done' | typeof activationSteps[number]['key']

const progressLabel: Record<Progress, string> = {
  idle: 'Authorize automation & activate',
  preparing: 'Preparing account...',
  creating: 'Creating strategy...',
  configuring: 'Linking smart account...',
  binding: 'Binding live market...',
  rollover: 'Authorizing automatic rollover...',
  'subscribing-fill': 'Subscribing to trades (1 of 3)...',
  'subscribing-resolution': 'Subscribing to results (2 of 3)...',
  'subscribing-successor': 'Subscribing to next markets (3 of 3)...',
  activating: 'Arming strategy...',
  done: 'Strategy armed',
}

export function ActivationDialog({
  open,
  manifest,
  market,
  wallet,
  onClose,
  onActivity,
  onActivated,
}: ActivationDialogProps) {
  const [preflight, setPreflight] = useState<ActivationPreflight>()
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<Progress>('idle')
  const [error, setError] = useState('')
  const [transaction, setTransaction] = useState<TransactionUpdate>()
  const operationLock = useRef(false)
  const [strategyId, setStrategyId] = useState<Hex>()
  const [marketBound, setMarketBound] = useState(false)
  const [executionConfigured, setExecutionConfigured] = useState(false)
  const [successorSubscriptionId, setSuccessorSubscriptionId] = useState<bigint>()
  const [automaticRolloverConfigured, setAutomaticRolloverConfigured] = useState(false)
  const [resolutionSubscriptionId, setResolutionSubscriptionId] = useState<bigint>()
  const [subscriptionId, setSubscriptionId] = useState<bigint>()
  const activationKey = useMemo(
    () => `${wallet.address}:${market.marketId}:${JSON.stringify(manifest)}`,
    [manifest, market.marketId, wallet.address],
  )

  useEffect(() => {
    setStrategyId(undefined)
    setMarketBound(false)
    setExecutionConfigured(false)
    setSubscriptionId(undefined)
    setResolutionSubscriptionId(undefined)
    setSuccessorSubscriptionId(undefined)
    setAutomaticRolloverConfigured(false)
    setProgress('idle')
    setError('')
    setTransaction(undefined)
  }, [activationKey])

  useEffect(() => {
    if (!open) return
    let disposed = false
    let unsubscribe = () => {}
    void import('../lib/contracts/activation').then(actions => {
      if (!disposed) unsubscribe = actions.observeTransactions(setTransaction)
    }).catch(cause => { if (!disposed) setError(walletErrorMessage(cause)) })
    return () => { disposed = true; unsubscribe() }
  }, [open])

  const check = async () => {
    setChecking(true)
    setError('')
    try {
      const { inspectActivation } = await import('../lib/contracts/activation')
      const result = await inspectActivation(
        wallet,
        market,
        manifest,
        manifest.policy.minSecondsToExpiry,
        subscriptionId === undefined,
      )
      setPreflight(result)
      return result
    } catch (cause) {
      setPreflight(undefined)
      setError(walletErrorMessage(cause))
      return undefined
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (open) void check()
  // activationKey intentionally captures every input that invalidates preflight.
  }, [open, activationKey])

  if (!open) return null

  const activate = async () => {
    if (operationLock.current) return
    const provider = window.ethereum
    if (!provider) return setError('Injected wallet is no longer available.')
    operationLock.current = true
    setTransaction(undefined)
    setError('')
    let currentStrategyId = strategyId
    let currentSubscriptionId = subscriptionId
    try {
      const latest = await check()
      if (!latest?.ready || !latest.deployment) return
      const actions = await import('../lib/contracts/activation')
      if (!currentStrategyId) {
        setProgress('creating')
        const created = await actions.createStrategyTransaction(provider, wallet.address, latest.deployment, manifest)
        currentStrategyId = created.strategyId
        setStrategyId(created.strategyId)
        onActivity('Strategy created', `${created.strategyId.slice(0, 10)}... · block ${created.blockNumber}`, 'success', created.hash)
      }

      if (!marketBound) {
        const smartAccount = latest.smartAccount
        if (!executionConfigured || !smartAccount) {
          if (!smartAccount) throw new Error('Smart account deployment is not configured.')
          setProgress('configuring')
          const configured = await actions.setExecutionAccountTransaction(
            provider,
            wallet.address,
            latest.deployment,
            currentStrategyId,
            smartAccount,
          )
          setExecutionConfigured(true)
          onActivity('Smart account linked', `${smartAccount.slice(0, 10)}... · CircuitEngine executor`, 'success', configured.hash)
        }
        setProgress('binding')
        const bound = await actions.bindMarketTransaction(
          provider,
          wallet.address,
          latest.deployment,
          manifest,
          market,
          currentStrategyId,
        )
        setMarketBound(true)
        onActivity('Market bound', `${market.asset} · ${market.marketId.slice(0, 10)}...`, 'success', bound.hash)
      }

      if (!automaticRolloverConfigured) {
        setProgress('rollover')
        const permission = await actions.enableAutomaticRolloverTransaction(provider,wallet.address,latest.deployment,currentStrategyId)
        setAutomaticRolloverConfigured(true)
        onActivity('Automatic rollover authorized','Verified same-series windows only; exact next-round pool approvals.','success',permission.hash)
      }

      if (currentSubscriptionId === undefined) {
        setProgress('subscribing-fill')
        const subscribed = await actions.createSubscriptionTransaction(
          provider,
          wallet.address,
          latest.deployment,
          market,
        )
        currentSubscriptionId = subscribed.subscriptionId
        setSubscriptionId(subscribed.subscriptionId)
        onActivity('Reactivity subscribed', `Subscription #${subscribed.subscriptionId}`, 'reactivity', subscribed.hash)
      }

      let currentResolutionId=resolutionSubscriptionId
      let currentSuccessorId=successorSubscriptionId
      if (currentResolutionId === undefined) {
        setProgress('subscribing-resolution')
        const subscribed = await actions.createSubscriptionTransaction(provider, wallet.address, latest.deployment, market, 'resolution')
        currentResolutionId=subscribed.subscriptionId
        setResolutionSubscriptionId(subscribed.subscriptionId)
        onActivity('Resolution subscribed', `Subscription #${subscribed.subscriptionId}`, 'reactivity', subscribed.hash)
      }

      if (currentSuccessorId === undefined) {
        setProgress('subscribing-successor')
        const subscribed = await actions.createSubscriptionTransaction(provider,wallet.address,latest.deployment,market,'successor')
        currentSuccessorId=subscribed.subscriptionId
        setSuccessorSubscriptionId(subscribed.subscriptionId)
        onActivity('Successor discovery subscribed',`Subscription #${subscribed.subscriptionId}`,'reactivity',subscribed.hash)
      }

      setProgress('activating')
      const armed = await actions.strategyTransaction(
        provider,
        wallet.address,
        latest.deployment,
        'activateStrategy',
        currentStrategyId,
      )
      onActivity('Strategy armed', `CircuitEngine confirmed at block ${armed.blockNumber}`, 'success', armed.hash)
      setProgress('done')
      onActivated(currentStrategyId, currentSubscriptionId, {subscriptions:[currentSubscriptionId,currentResolutionId,currentSuccessorId],blockNumber:armed.blockNumber})
    } catch (cause) {
      setProgress('idle')
      setTransaction(undefined)
      setError(walletErrorMessage(cause))
    } finally {
      operationLock.current = false
    }
  }

  const prepareSmartAccount = async () => {
    if (operationLock.current) return
    const provider = window.ethereum
    if (!provider) return setError('Injected wallet is no longer available.')
    operationLock.current = true
    setTransaction(undefined)
    setProgress('preparing')
    setError('')
    try {
      const latest = await check()
      if (!latest?.canPrepareAccount || !latest.smartAccount) return
      const actions = await import('../lib/contracts/activation')
      const prepared = await actions.prepareSmartAccountTransactions(
        provider,
        wallet.address,
        latest.smartAccount,
        market,
        manifest,
      )
      if (prepared.faucet) onActivity('Collateral faucet funded', `tUSDC minted · ${prepared.faucet.hash.slice(0, 10)}...`, 'success', prepared.faucet.hash)
      if (prepared.transfer) onActivity('Smart account funded', `${manifest.action.maxCollateral} tUSDC transferred`, 'success', prepared.transfer.hash)
      if (prepared.approval) onActivity('Pool allowance approved', `${market.pool.slice(0, 10)}... · exact order cap`, 'success', prepared.approval.hash)
      await check()
    } catch (cause) {
      setTransaction(undefined)
      setError(walletErrorMessage(cause))
    } finally {
      operationLock.current = false
      setProgress('idle')
    }
  }

  const busy = checking || !['idle', 'done'].includes(progress)
  const needsPreparation = !!preflight?.canPrepareAccount
  const completedSteps = [!!strategyId, executionConfigured, marketBound, automaticRolloverConfigured, subscriptionId !== undefined, resolutionSubscriptionId !== undefined, successorSubscriptionId !== undefined, progress === 'done']
  const completedCount = completedSteps.filter(Boolean).length
  const remainingCount = activationSteps.length - completedCount
  const activeStep = activationSteps.findIndex(step => step.key === progress)
  const progressTitle = activeStep >= 0
    ? `Step ${activeStep + 1} of ${activationSteps.length} · ${activationSteps[activeStep].label}`
    : progress === 'preparing' ? 'Account preparation · up to 3 transactions'
    : progress === 'done' ? 'All 8 activation steps confirmed'
    : completedCount ? `${completedCount} of 8 confirmed · ${remainingCount} remaining` : 'Activation · 8 wallet confirmations'

  return <Modal title="Review and activate" eyebrow="ON-CHAIN ACTIVATION" onClose={onClose} busy={busy} wide>
    <div className="modal-body activation-body" aria-busy={busy}>
      <p>Activation requires 8 separate transactions, each confirmed in your wallet. Account preparation may require up to 3 additional transactions. Opening this review sends nothing.</p>
      <details className="activation-step-details">
        <summary>See all 8 activation steps</summary>
        <ol className="activation-step-list">
          {activationSteps.map((step, index) => <li key={step.key} className={completedSteps[index]?'complete':step.key===progress?'current':''} aria-current={step.key===progress?'step':undefined}>
            <span>{completedSteps[index]?<Check size={13}/>:index+1}</span>
            {step.label}
            <small>{completedSteps[index]?'Confirmed':step.key===progress?'In progress':'Pending'}</small>
          </li>)}
        </ol>
      </details>
      <div className="activation-summary">
        <div><span>Strategy</span><strong>{manifest.name}</strong></div>
        <div><span>Market</span><strong>{market.asset} · {market.intervalSec / 60}m</strong></div>
        <div><span>Owner</span><strong>{wallet.address.slice(0, 8)}...{wallet.address.slice(-6)}</strong></div>
      </div>

      <div className="activation-checks">
        {checking && !preflight && <div className="activation-loading"><LoaderCircle size={17} className="spin" /> Checking Shannon state...</div>}
        {preflight?.checks.map((item) => <div className={`activation-check ${item.state}`} key={item.id}>
          <span className="check-icon">{item.state === 'pass' ? <Check size={14} /> : <CircleAlert size={14} />}</span>
          <div><strong>{item.label}</strong><small>{item.detail}</small></div>
        </div>)}
      </div>

      {needsPreparation && <div className="activation-next-step">
        <strong>Next: prepare your smart account</strong>
        <p>Your smart account needs {manifest.action.maxCollateral} tUSDC available for this order and an allowance to this market’s pool. Your wallet’s STT balance pays for gas and subscriptions; it is separate from this collateral.</p>
        <p>Prepare account requests any missing test collateral, transfers the shortfall and approves the order limit. Each required transaction asks for wallet confirmation.</p>
      </div>}

      {transaction && <div className="activation-transaction" role="status" aria-live="polite">
        {activeStep >= 0 && <p>{progressTitle}</p>}
        <strong>{transaction.phase==='confirmed'?<Check size={16}/>:<LoaderCircle size={16} className="spin"/>}
          {transaction.phase==='signature'?'Confirm in your wallet':transaction.phase==='submitted'?'Transaction submitted':'Transaction confirmed'}
        </strong>
        <p>{transaction.phase==='signature'?'Open your wallet to review this request.':transaction.phase==='submitted'?'Waiting for the chain receipt.':progress==='done'?'All activation steps are complete.':busy?'Continuing to the next step.':'Account checks have been refreshed. Review the next step below.'}</p>
        {transaction.hash&&<ExplorerLink hash={transaction.hash}/>}
      </div>}

      <div className="activation-disclosure">
        <LockKeyhole size={15} />
        <p><strong>Explicit wallet confirmations</strong><span>Prepare collateral if needed, create the strategy, link the account, bind the market, create Reactivity, then arm. The account remains user-owned. The Engine can place bounded orders, redeem tracked positions and approve authorized successor pools.</span></p>
      </div>

      {error && <div className="activation-error" role="alert"><CircleAlert size={15} /><span>{error}</span></div>}
    </div>
      <footer className="activation-footer activation-sticky-footer">
        <div className="activation-progress" role="status" aria-live="polite">
          <strong>{progressTitle}</strong>
          <span>{progress==='preparing'?'Preparation is separate from the 8 activation steps.':activeStep>=0?`${completedCount} confirmed · ${remainingCount} remaining, including this step`:completedCount?'Confirmed steps are retained while this dialog stays open.':'Three of these transactions create separate Reactivity subscriptions.'}</span>
          <progress max={activationSteps.length} value={completedCount} aria-label="Confirmed activation steps"/>
        </div>
        <div className="activation-footer-links">
          <a className="text-link" href={`https://shannon-explorer.somnia.network/address/${preflight?.deployment?.engine ?? market.pool}`} target="_blank" rel="noreferrer">Inspect contracts <ExternalLink size={13} /></a>
          <button className="text-link" onClick={()=>void check()} disabled={busy}><RefreshCw size={13}/> Recheck readiness</button>
        </div>
        <div className="activation-actions">
          {needsPreparation && <button className="btn btn-primary" onClick={() => void prepareSmartAccount()} disabled={busy}>
            {progress === 'preparing' && <LoaderCircle size={15} className="spin" />} Prepare account
          </button>}
          <button className={`btn ${needsPreparation?'btn-white':'btn-primary'}`} onClick={() => void activate()} disabled={busy || !preflight?.ready || progress === 'done'}>
          {busy && <LoaderCircle size={15} className="spin" />}{progress==='idle'&&completedCount?`Resume activation · ${remainingCount} remaining`:progressLabel[progress]}
          </button>
          <p>{checking?'Checking the account and live market…':progress==='done'?'Strategy activated.':busy?'Keep this page open until setup finishes. Each confirmed step advances the progress above.':needsPreparation?'Prepare account first. Activation becomes available when all checks pass.':preflight?.ready?`Ready. ${remainingCount} activation transaction${remainingCount===1?'':'s'} will request wallet confirmation.`:'Activation is blocked until the checks above pass. Resolve the highlighted issue, then recheck readiness.'}</p>
        </div>
      </footer>
  </Modal>
}
