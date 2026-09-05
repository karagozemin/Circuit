import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, ExternalLink, LoaderCircle, LockKeyhole, X } from 'lucide-react'
import type { Hex } from 'viem'
import type { StrategyManifest } from '../lib/strategy'
import type { TradingMarketSnapshot } from '../lib/dreamdex/discovery'
import type { WalletSnapshot } from '../lib/wallet'
import { walletErrorMessage } from '../lib/wallet'
import type { ActivationPreflight } from '../lib/contracts/activation'

type ActivityKind = 'system' | 'trade' | 'reactivity' | 'success'

interface ActivationDialogProps {
  open: boolean
  manifest: StrategyManifest
  market: TradingMarketSnapshot
  wallet: WalletSnapshot
  onClose: () => void
  onActivity: (title: string, detail: string, kind: ActivityKind, hash?: Hex) => void
  onActivated: (strategyId: Hex, subscriptionId: bigint) => void
}

type Progress = 'idle' | 'creating' | 'binding' | 'subscribing' | 'activating' | 'done'

const progressLabel: Record<Progress, string> = {
  idle: 'Activate on Shannon',
  creating: 'Creating strategy...',
  binding: 'Binding live market...',
  subscribing: 'Creating Reactivity subscription...',
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
  const [strategyId, setStrategyId] = useState<Hex>()
  const [marketBound, setMarketBound] = useState(false)
  const [subscriptionId, setSubscriptionId] = useState<bigint>()
  const activationKey = useMemo(
    () => `${wallet.address}:${market.marketId}:${JSON.stringify(manifest)}`,
    [manifest, market.marketId, wallet.address],
  )

  useEffect(() => {
    setStrategyId(undefined)
    setMarketBound(false)
    setSubscriptionId(undefined)
    setProgress('idle')
    setError('')
  }, [activationKey])

  const check = async () => {
    setChecking(true)
    setError('')
    try {
      const { inspectActivation } = await import('../lib/contracts/activation')
      const result = await inspectActivation(
        wallet,
        market,
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
    const provider = window.ethereum
    if (!provider) return setError('Injected wallet is no longer available.')

    const latest = await check()
    if (!latest?.ready || !latest.deployment) return

    setError('')
    let currentStrategyId = strategyId
    let currentSubscriptionId = subscriptionId
    try {
      const actions = await import('../lib/contracts/activation')
      if (!currentStrategyId) {
        setProgress('creating')
        const created = await actions.createStrategyTransaction(provider, wallet.address, latest.deployment, manifest)
        currentStrategyId = created.strategyId
        setStrategyId(created.strategyId)
        onActivity('Strategy created', `${created.strategyId.slice(0, 10)}... · block ${created.blockNumber}`, 'success', created.hash)
      }

      if (!marketBound) {
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

      if (currentSubscriptionId === undefined) {
        setProgress('subscribing')
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
      onActivated(currentStrategyId, currentSubscriptionId)
    } catch (cause) {
      setProgress('idle')
      setError(walletErrorMessage(cause))
    }
  }

  const busy = checking || !['idle', 'done'].includes(progress)

  return <div className="activation-backdrop" role="presentation">
    <section className="activation-dialog" role="dialog" aria-modal="true" aria-labelledby="activation-title">
      <header className="activation-header">
        <div><span className="section-kicker">ON-CHAIN ACTIVATION</span><h2 id="activation-title">Review and arm</h2></div>
        <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close activation"><X size={18} /></button>
      </header>

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

      <div className="activation-disclosure">
        <LockKeyhole size={15} />
        <p><strong>Four wallet confirmations</strong><span>Create strategy, bind market, fund Reactivity, then arm. Live orders use direct market-sdk calls and each asks your wallet to sign.</span></p>
      </div>

      {error && <div className="activation-error"><CircleAlert size={15} /><span>{error}</span></div>}

      <footer className="activation-footer">
        <a href={`https://shannon-explorer.somnia.network/address/${preflight?.deployment?.engine ?? market.pool}`} target="_blank" rel="noreferrer">Inspect contracts <ExternalLink size={13} /></a>
        <button className="primary-button" onClick={() => void activate()} disabled={busy || !preflight?.ready || progress === 'done'}>
          {busy && <LoaderCircle size={15} className="spin" />}{progressLabel[progress]}
        </button>
      </footer>
    </section>
  </div>
}
