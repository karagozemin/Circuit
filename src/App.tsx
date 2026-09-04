import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownToLine, ArrowUpFromLine, Bot, Check, ChevronRight, CircleHelp, Clock3, Code2, Copy, ExternalLink, GitBranch, Layers3, Link2, LockKeyhole, LogOut, Pause, Play, Plus, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, Wallet, X } from 'lucide-react'
import type { Hex } from 'viem'
import { ActivationDialog } from './components/ActivationDialog'
import { manifestHash } from './lib/contracts/engine'
import type { TradingMarketSnapshot } from './lib/dreamdex/discovery'
import { canonicalManifest, compileIntent, initialManifest, StrategyManifest, validateManifest } from './lib/strategy'
import { formatSttBalance, readWallet, shortAddress, SHANNON_CHAIN_ID, switchToShannon, WALLET_AUTOCONNECT_KEY, walletErrorMessage, type WalletSnapshot } from './lib/wallet'

type Status = 'DRAFT' | 'VALIDATED' | 'ARMED' | 'TRIGGERED' | 'FILLED' | 'WAITING_RESOLUTION' | 'ROLLING' | 'PAUSED' | 'STOPPED'
type ActivityItem = { time: string; title: string; detail: string; kind: 'system' | 'trade' | 'reactivity' | 'success'; hash?: Hex }
type MarketHealth = { state: 'loading' | 'live' | 'error'; market?: TradingMarketSnapshot; error?: string }
type WalletState = { state: 'idle' | 'connecting' | 'connected' | 'wrong-network' | 'unavailable' | 'error'; snapshot?: WalletSnapshot; error?: string }

const initialActivity: ActivityItem[] = []
const activeStatuses = new Set<Status>(['ARMED', 'TRIGGERED', 'FILLED', 'WAITING_RESOLUTION', 'ROLLING', 'PAUSED'])
const now = () => new Date().toLocaleTimeString('en-GB', { hour12: false })

function App() {
  const [manifest, setManifest] = useState<StrategyManifest>(initialManifest)
  const [status, setStatus] = useState<Status>('DRAFT')
  const [walletState, setWalletState] = useState<WalletState>({ state: 'idle' })
  const [walletMenu, setWalletMenu] = useState(false)
  const [agentText, setAgentText] = useState('If BTC 15m UP trades above 70%, buy DOWN with 10. Roll half after a win and stop after two losses. Never risk more than 20.')
  const [agentDraft, setAgentDraft] = useState(false)
  const [activity, setActivity] = useState(initialActivity)
  const [activeTab, setActiveTab] = useState<'builder' | 'live'>('builder')
  const [notice, setNotice] = useState('')
  const [marketHealth, setMarketHealth] = useState<MarketHealth>({ state: 'loading' })
  const [activationOpen, setActivationOpen] = useState(false)
  const [strategyId, setStrategyId] = useState<Hex>()
  const [subscriptionId, setSubscriptionId] = useState<bigint>()
  const [controlBusy, setControlBusy] = useState(false)
  const issues = useMemo(() => validateManifest(manifest), [manifest])
  const riskPercent = Math.min(100, (Number(manifest.policy.maxTotalCapitalAtRisk) / 40) * 100)
  const walletConnected = walletState.state === 'connected'
  const strategyIsActive = activeStatuses.has(status)

  useEffect(() => {
    let cancelled = false
    setMarketHealth({ state: 'loading' })
    void import('./lib/dreamdex/discovery')
      .then(({ discoverTradingMarket }) => discoverTradingMarket({ asset: manifest.series.asset, intervalSec: manifest.series.intervalSec, minSecondsToExpiry: manifest.policy.minSecondsToExpiry }))
      .then((market) => { if (!cancelled) setMarketHealth({ state: 'live', market }) })
      .catch((error: unknown) => { if (!cancelled) setMarketHealth({ state: 'error', error: error instanceof Error ? error.message : String(error) }) })
    return () => { cancelled = true }
  }, [manifest.series.asset, manifest.series.intervalSec, manifest.policy.minSecondsToExpiry])

  useEffect(() => {
    const provider = window.ethereum
    if (!provider) return

    const refresh = () => {
      if (localStorage.getItem(WALLET_AUTOCONNECT_KEY) !== 'true') return
      void readWallet(provider)
        .then((snapshot) => setWalletState(snapshot
          ? { state: snapshot.chainId === SHANNON_CHAIN_ID ? 'connected' : 'wrong-network', snapshot }
          : { state: 'idle' }))
        .catch((error: unknown) => setWalletState({ state: 'error', error: walletErrorMessage(error) }))
    }
    const disconnected = () => {
      localStorage.removeItem(WALLET_AUTOCONNECT_KEY)
      setWalletState({ state: 'idle' })
      setWalletMenu(false)
    }

    refresh()
    provider.on?.('accountsChanged', refresh)
    provider.on?.('chainChanged', refresh)
    provider.on?.('disconnect', disconnected)
    return () => {
      provider.removeListener?.('accountsChanged', refresh)
      provider.removeListener?.('chainChanged', refresh)
      provider.removeListener?.('disconnect', disconnected)
    }
  }, [])

  const patch = (next: Partial<StrategyManifest>) => setManifest((current) => ({ ...current, ...next }))
  const appendActivity = (item: ActivityItem) => setActivity((items) => [item, ...items])

  const connectWallet = async () => {
    const provider = window.ethereum
    if (!provider) {
      setWalletState({ state: 'unavailable' })
      setNotice('No injected wallet was found in this browser.')
      return
    }
    setWalletState({ state: 'connecting' })
    try {
      const snapshot = await readWallet(provider, true)
      if (!snapshot) throw new Error('The wallet did not return an account.')
      localStorage.setItem(WALLET_AUTOCONNECT_KEY, 'true')
      setWalletState({ state: snapshot.chainId === SHANNON_CHAIN_ID ? 'connected' : 'wrong-network', snapshot })
      setNotice(snapshot.chainId === SHANNON_CHAIN_ID ? 'Wallet connected to Somnia Shannon.' : 'Wallet connected. Switch to Somnia Shannon to continue.')
      appendActivity({ time: now(), title: 'Wallet connected', detail: `${shortAddress(snapshot.address)} · no transaction sent`, kind: 'success' })
    } catch (error) {
      const message = walletErrorMessage(error)
      setWalletState({ state: 'error', error: message })
      setNotice(message)
    }
  }

  const switchNetwork = async () => {
    const provider = window.ethereum
    if (!provider) return void connectWallet()
    try {
      await switchToShannon(provider)
      const snapshot = await readWallet(provider)
      if (!snapshot) throw new Error('Wallet account is no longer available.')
      setWalletState({ state: snapshot.chainId === SHANNON_CHAIN_ID ? 'connected' : 'wrong-network', snapshot })
      setNotice(snapshot.chainId === SHANNON_CHAIN_ID ? 'Network switched to Somnia Shannon.' : 'Wallet did not switch to Somnia Shannon.')
    } catch (error) {
      const message = walletErrorMessage(error)
      setWalletState((current) => ({ ...current, state: current.snapshot ? 'wrong-network' : 'error', error: message }))
      setNotice(message)
    }
  }

  const disconnectWallet = () => {
    localStorage.removeItem(WALLET_AUTOCONNECT_KEY)
    setWalletState({ state: 'idle' })
    setWalletMenu(false)
    setNotice('Wallet disconnected from Circuit. No on-chain permission was changed.')
  }

  const compile = () => {
    const draft = compileIntent(agentText) as StrategyManifest
    setManifest(draft)
    setAgentDraft(true)
    setNotice('AI draft ready. Review every bound before activation.')
    appendActivity({ time: now(), title: 'Agent draft generated', detail: 'Canonical manifest proposed for review', kind: 'system' })
  }

  const validate = () => {
    if (issues.length) { setNotice(issues[0].message); return }
    setStatus('VALIDATED'); setNotice('Manifest validated. All safety bounds are finite and deterministic.')
    const hash = manifestHash(manifest)
    appendActivity({ time: now(), title: 'Manifest validated', detail: `${hash.slice(0, 10)}...${hash.slice(-6)} · v1`, kind: 'success' })
  }

  const activate = () => {
    if (!walletState.snapshot) { setNotice('Connect a Somnia wallet before activation.'); return }
    if (!walletConnected) { setNotice('Switch the connected wallet to Somnia Shannon before activation.'); return }
    if (issues.length) { setNotice('Resolve validation issues before activation.'); return }
    if (marketHealth.state !== 'live') { setNotice('A verified on-chain Trading market is required before activation.'); return }
    setActivationOpen(true)
  }

  const simulate = () => {
    if (status !== 'ARMED') return
    setStatus('TRIGGERED'); appendActivity({ time: now(), title: 'Preview trigger matched', detail: 'Local simulation · no transaction sent', kind: 'reactivity' })
    window.setTimeout(() => { setStatus('FILLED'); appendActivity({ time: now(), title: 'Preview BUY DOWN fill', detail: 'Local simulation · not an on-chain fill', kind: 'trade' }) }, 500)
    window.setTimeout(() => { setStatus('WAITING_RESOLUTION'); appendActivity({ time: now(), title: 'Preview waiting for resolution', detail: 'Local simulation · no capital at risk', kind: 'system' }) }, 1000)
  }

  const sendControl = async (action: 'pauseStrategy' | 'resumeStrategy') => {
    const provider = window.ethereum
    if (!provider || !walletState.snapshot || !strategyId) {
      setNotice('A connected owner wallet and on-chain strategy are required.')
      return
    }
    setControlBusy(true)
    try {
      const actions = await import('./lib/contracts/activation')
      const deployment = actions.configuredDeployment()
      if (!deployment) throw new Error('Circuit deployment addresses are not configured.')
      const result = await actions.strategyTransaction(provider, walletState.snapshot.address, deployment, action, strategyId)
      const paused = action === 'pauseStrategy'
      setStatus(paused ? 'PAUSED' : 'ARMED')
      setNotice(paused ? 'Strategy paused on-chain.' : 'Strategy resumed on-chain.')
      appendActivity({
        time: now(),
        title: paused ? 'Strategy paused' : 'Strategy resumed',
        detail: `Confirmed at block ${result.blockNumber}`,
        kind: paused ? 'system' : 'success',
        hash: result.hash,
      })
    } catch (error) {
      setNotice(walletErrorMessage(error))
    } finally {
      setControlBusy(false)
    }
  }

  const pause = () => void sendControl('pauseStrategy')
  const resume = () => void sendControl('resumeStrategy')

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><GitBranch size={17} strokeWidth={2.5} /></div><span>CIRCUIT</span><small>STRATEGY ENGINE</small></div>
      <div className="network"><span className={`pulse ${marketHealth.state}`} /> Somnia Shannon <span className="network-divider" /> <span className="testnet">TESTNET</span></div>
      <div className="top-actions"><button className="icon-button" title="Help"><CircleHelp size={18} /></button><div className="wallet-control"><button className={`wallet ${walletConnected ? 'connected' : walletState.state === 'wrong-network' ? 'warning' : ''}`} disabled={walletState.state === 'connecting'} aria-expanded={walletMenu} onClick={() => walletState.state === 'wrong-network' ? void switchNetwork() : walletConnected ? setWalletMenu((open) => !open) : void connectWallet()}><Wallet size={16} />{walletState.state === 'connecting' ? 'Connecting...' : walletState.state === 'wrong-network' ? 'Switch network' : walletState.snapshot ? shortAddress(walletState.snapshot.address) : 'Connect wallet'}</button>{walletMenu && walletConnected && walletState.snapshot && <div className="wallet-menu" role="menu"><div className="wallet-summary"><span>CONNECTED ACCOUNT</span><strong>{shortAddress(walletState.snapshot.address)}</strong><small>{formatSttBalance(walletState.snapshot.balance)} · Shannon</small></div><button onClick={() => { void navigator.clipboard?.writeText(walletState.snapshot!.address); setNotice('Wallet address copied.') }}><Copy size={14} /> Copy address</button><a href={`https://shannon-explorer.somnia.network/address/${walletState.snapshot.address}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> View on explorer</a><button className="disconnect" onClick={disconnectWallet}><LogOut size={14} /> Disconnect</button></div>}</div></div>
    </header>
    <div className="workspace">
      <aside className="sidebar"><div className="eyebrow">CONTROL ROOM</div><nav><button className="nav-item active"><Layers3 size={17} /> Strategies <span className="nav-count">1</span></button><button className="nav-item"><Activity size={17} /> Activity</button></nav><div className="sidebar-divider" /><div className="eyebrow">ENVIRONMENT</div><div className="side-status"><span className={`status-dot ${marketHealth.state === 'live' ? 'green' : marketHealth.state === 'error' ? 'amber' : ''}`} /><div><strong>{marketHealth.state === 'live' ? 'Live market verified' : marketHealth.state === 'error' ? 'Market unavailable' : 'Checking chain truth'}</strong><small>{marketHealth.market ? `Block ${marketHealth.market.blockNumber.toString()} · ${marketHealth.market.marketId.slice(-6)}` : marketHealth.state === 'error' ? 'Activation safely blocked' : 'RPC · dreamDEX indexer'}</small></div></div><div className="sidebar-footer"><LockKeyhole size={14} /> Non-custodial by design</div></aside>
      <main className="main"><div className="page-header"><div><div className="breadcrumb">STRATEGIES <ChevronRight size={14} /> NEW STRATEGY</div><h1>Build a strategy<span className="period">.</span></h1><p>Programmable rules for dreamDEX Event Contracts.</p></div><div className="header-actions"><button className="ghost-button" onClick={() => { setManifest(initialManifest); setStatus('DRAFT'); setStrategyId(undefined); setSubscriptionId(undefined); setNotice('Draft reset.') }}><RefreshCw size={15} /> Reset</button><button className="primary-button" onClick={activate}><Play size={15} fill="currentColor" /> Activate</button></div></div>
        <div className="tabs"><button className={activeTab === 'builder' ? 'tab active' : 'tab'} onClick={() => setActiveTab('builder')}><SlidersHorizontal size={15} /> Builder</button><button className={activeTab === 'live' ? 'tab active' : 'tab'} onClick={() => setActiveTab('live')}><Activity size={15} /> Live activity {status !== 'DRAFT' && <span className="tab-live" />}</button><div className="tab-status"><span className={`status-pill ${status.toLowerCase()}`}><span /> {status.replace('_', ' ')}</span></div></div>
        {notice && <div className="notice"><Sparkles size={15} /><span>{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div>}
        {activeTab === 'builder' ? <div className="builder-grid"><section className="builder-canvas"><div className="section-heading"><div><span className="section-kicker">STRATEGY GRAPH</span><h2>{manifest.name}</h2></div><button className="small-button" title="Copy manifest" onClick={() => navigator.clipboard?.writeText(canonicalManifest(manifest))}><Copy size={14} /> JSON</button></div><div className="graph"><div className="graph-line" /><div className="node start"><div className="node-icon blue"><Clock3 size={16} /></div><div><span className="node-label">MARKET</span><strong>{manifest.series.asset} · {manifest.series.intervalSec === 900 ? '15m' : '1h'}</strong><small>{marketHealth.market ? `live · ${Math.floor(marketHealth.market.secondsToExpiry / 60)}m left · UP ${marketHealth.market.bestYesBid ?? '—'} / ${marketHealth.market.bestYesAsk ?? '—'}` : marketHealth.state === 'error' ? 'no eligible on-chain market' : 'resolving live window…'}</small></div>{marketHealth.state === 'live' && <Check size={15} className="node-check" />}</div><div className="connector"><span>WHEN</span></div><div className="node condition"><div className="node-icon amber"><Activity size={16} /></div><div><span className="node-label">TRIGGER</span><strong>UP last fill <em>{manifest.trigger.type === 'LAST_FILL_PRICE_ABOVE' ? '>' : '<'} {manifest.trigger.value}</em></strong><small>on-chain OrderFilled event</small></div><span className="yes-chip">YES</span></div><div className="connector"><span>THEN</span></div><div className="node action"><div className="node-icon red"><ArrowDownToLine size={16} /></div><div><span className="node-label">ACTION</span><strong>{manifest.action.type === 'BUY_DOWN' ? 'BUY DOWN' : 'BUY UP'} <em>· max {manifest.action.maxCollateral}</em></strong><small>IOC · {manifest.action.maxSlippageBps} bps max slippage</small></div><Check size={15} className="node-check" /></div><div className="connector split"><span>ON RESOLUTION</span></div><div className="branch-grid"><div className="branch win"><div className="branch-title"><span className="branch-dot" /> WIN</div><strong>ROLL {manifest.resolution.onWin.rollPercent}%</strong><small>realized proceeds only</small><div className="branch-arrow">↘</div></div><div className="branch loss"><div className="branch-title"><span className="branch-dot" /> LOSS</div><strong>LOSSES + 1</strong><small>stop at {manifest.policy.stopAfterConsecutiveLosses}</small><div className="branch-arrow">↙</div></div></div><div className="merge-connector" /><div className="node next"><div className="node-icon green"><ArrowUpFromLine size={16} /></div><div><span className="node-label">CONTINUE</span><strong>NEXT WINDOW</strong><small>re-resolve live market binding</small></div><Check size={15} className="node-check" /></div></div><div className="graph-footer"><span><span className="legend-dot green" /> deterministic</span><span><span className="legend-dot amber" /> event-driven</span><span><LockKeyhole size={12} /> no arbitrary calls</span></div></section>
          <aside className="config-column"><div className="panel config-panel"><div className="panel-heading"><div><span className="section-kicker">CONFIGURATION</span><h3>Strategy parameters</h3></div><Code2 size={17} /></div><label>Strategy name<input value={manifest.name} onChange={(e) => patch({ name: e.target.value })} /></label><div className="field-row"><label>Asset<select value={manifest.series.asset} onChange={(e) => patch({ series: { ...manifest.series, asset: e.target.value as 'BTC' | 'ETH' } })}><option>BTC</option><option>ETH</option></select></label><label>Cadence<select value={manifest.series.intervalSec} onChange={(e) => patch({ series: { ...manifest.series, intervalSec: Number(e.target.value) as 900 | 3600 } })}><option value="900">15 min</option><option value="3600">1 hour</option></select></label></div><div className="field-row"><label>Trigger threshold<div className="input-suffix"><input value={manifest.trigger.value} onChange={(e) => patch({ trigger: { ...manifest.trigger, value: e.target.value } })} /><span>UP prob.</span></div></label><label>Side<select value={manifest.action.type} onChange={(e) => patch({ action: { ...manifest.action, type: e.target.value as 'BUY_UP' | 'BUY_DOWN' } })}><option value="BUY_DOWN">Buy DOWN</option><option value="BUY_UP">Buy UP</option></select></label></div><div className="field-row"><label>Max order<input value={manifest.action.maxCollateral} onChange={(e) => patch({ action: { ...manifest.action, maxCollateral: e.target.value } })} /></label><label>Hard cap<input value={manifest.policy.maxTotalCapitalAtRisk} onChange={(e) => patch({ policy: { ...manifest.policy, maxTotalCapitalAtRisk: e.target.value } })} /></label></div><div className="field-row"><label>Roll after win<div className="input-suffix"><input value={manifest.resolution.onWin.rollPercent} onChange={(e) => patch({ resolution: { ...manifest.resolution, onWin: { rollPercent: Number(e.target.value) } } })} /><span>%</span></div></label><label>Stop after losses<input value={manifest.policy.stopAfterConsecutiveLosses} onChange={(e) => patch({ policy: { ...manifest.policy, stopAfterConsecutiveLosses: Number(e.target.value) } })} /></label></div><button className="add-rule"><Plus size={14} /> Add rule</button></div><div className="panel risk-panel"><div className="panel-heading"><div><span className="section-kicker">RISK PREVIEW</span><h3>Bounded by design</h3></div><ShieldCheck size={18} className="shield" /></div><div className="risk-meter"><div className="risk-meter-top"><span>Capital at risk</span><strong>{manifest.policy.maxTotalCapitalAtRisk} <small>/ 40 suggested</small></strong></div><div className="meter"><span style={{ width: `${riskPercent}%` }} /></div></div><div className="risk-list"><div><Check size={14} /><span>Per-order limit</span><strong>{manifest.action.maxCollateral}</strong></div><div><Check size={14} /><span>Round limit</span><strong>{manifest.policy.maxRounds} rounds</strong></div><div><Check size={14} /><span>Expiry buffer</span><strong>{manifest.policy.minSecondsToExpiry}s</strong></div><div><Check size={14} /><span>Slippage cap</span><strong>{manifest.action.maxSlippageBps} bps</strong></div><div><Check size={14} /><span>Chain truth</span><strong>{marketHealth.state === 'live' ? 'Trading' : marketHealth.state === 'loading' ? 'Checking' : 'Blocked'}</strong></div><div><Wallet size={14} /><span>Wallet</span><strong>{walletConnected ? shortAddress(walletState.snapshot!.address) : walletState.state === 'wrong-network' ? 'Wrong network' : 'Required'}</strong></div></div><div className="risk-callout"><LockKeyhole size={14} /><span>Circuit can only execute this approved manifest. Limits are immutable after activation.</span></div></div><div className="panel agent-panel"><div className="agent-heading"><div className="agent-icon"><Bot size={16} /></div><div><span className="section-kicker">SOMNIA AGENT</span><h3>Describe your intent</h3></div><span className="draft-badge">{agentDraft ? 'DRAFT READY' : 'OPTIONAL'}</span></div><textarea value={agentText} onChange={(e) => setAgentText(e.target.value)} /><button className="agent-button" onClick={compile}><Sparkles size={14} /> Compile to strategy</button><small className="agent-note">AI-generated draft · review before activation</small></div></aside></div> : <div className="live-view"><div className="live-summary"><div><span className="section-kicker">STRATEGY STATE</span><h2>{manifest.name}</h2><p>{strategyIsActive ? `${manifest.series.asset} ${manifest.series.intervalSec === 900 ? '15m' : '1h'} · Round 1 of ${manifest.policy.maxRounds}${subscriptionId !== undefined ? ` · Reactivity #${subscriptionId}` : ''}` : 'No strategy has been activated on-chain.'}</p></div><div className="live-controls">{status === 'PAUSED' ? <button className="primary-button" onClick={resume} disabled={controlBusy}><Play size={15} fill="currentColor" /> Resume</button> : strategyIsActive && status !== 'STOPPED' && <button className="danger-button" onClick={pause} disabled={controlBusy}><Pause size={15} /> Emergency pause</button>}{strategyIsActive && <button className="ghost-button" onClick={simulate} disabled={status !== 'ARMED' || controlBusy}><Sparkles size={15} /> Preview trigger</button>}</div></div><div className="live-grid"><div className="panel state-panel"><div className="state-orbit"><div className="orbit-ring" /><div className="orbit-core"><span className={`status-dot ${status === 'PAUSED' ? 'amber' : strategyIsActive ? 'green' : ''}`} /><strong>{status.replace('_', ' ')}</strong><small>current state</small></div></div><div className="state-metrics"><div><span>Observed UP</span><strong>{marketHealth.market?.bestYesAsk ?? '—'}</strong></div><div><span>Capital at risk</span><strong>0.00 <small>/ {manifest.policy.maxTotalCapitalAtRisk}</small></strong></div><div><span>Consecutive losses</span><strong>0 <small>/ {manifest.policy.stopAfterConsecutiveLosses}</small></strong></div></div><div className="next-action"><span className="section-kicker">NEXT REQUIRED ACTION</span><strong>{status === 'DRAFT' ? 'Validate manifest and connect wallet' : status === 'VALIDATED' ? 'Deploy and authorize CircuitEngine' : status === 'ARMED' ? 'Wait for UP fill above threshold' : status === 'PAUSED' ? 'Resume strategy to continue' : 'Waiting for market resolution'}</strong><ExternalLink size={14} /></div></div><div className="panel activity-panel"><div className="panel-heading"><div><span className="section-kicker">ACTIVITY TIMELINE</span><h3>Verified actions only</h3></div><span className={`live-badge ${strategyIsActive ? '' : 'inactive'}`}><span /> {strategyIsActive ? 'LIVE' : 'NOT ACTIVE'}</span></div><div className="timeline">{activity.length === 0 && <div className="empty-activity"><Activity size={18} /><strong>No activity yet</strong><span>Wallet, validation and on-chain actions will appear here.</span></div>}{activity.map((item, i) => <div className="timeline-item" key={`${item.time}-${i}`}><div className={`timeline-icon ${item.kind}`}><span>{item.kind === 'trade' ? '↙' : item.kind === 'reactivity' ? '✦' : item.kind === 'success' ? '✓' : '·'}</span></div><div className="timeline-copy"><div><strong>{item.title}</strong><time>{item.time}</time></div><p>{item.detail}</p>{item.hash && <a href={`https://shannon-explorer.somnia.network/tx/${item.hash}`} target="_blank" rel="noreferrer"><Link2 size={12} /> View transaction</a>}</div></div>)}</div></div></div></div>}
      </main>
    </div>
    {activationOpen && walletState.snapshot && marketHealth.market && <ActivationDialog
      open
      manifest={manifest}
      market={marketHealth.market}
      wallet={walletState.snapshot}
      onClose={() => setActivationOpen(false)}
      onActivity={(title, detail, kind, hash) => appendActivity({ time: now(), title, detail, kind, hash })}
      onActivated={(nextStrategyId, nextSubscriptionId) => {
        setStrategyId(nextStrategyId)
        setSubscriptionId(nextSubscriptionId)
        setStatus('ARMED')
        setActiveTab('live')
        setNotice('Strategy is armed on-chain and listening through Somnia Reactivity.')
        setActivationOpen(false)
      }}
    />}
  </div>
}

export default App
