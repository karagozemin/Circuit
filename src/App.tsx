import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownToLine, ArrowUpFromLine, Bot, Check, ChevronRight, CircleHelp, Clock3, Code2, Copy, ExternalLink, GitBranch, Layers3, Link2, LockKeyhole, Pause, Play, Plus, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, Wallet, X } from 'lucide-react'
import { canonicalManifest, compileIntent, initialManifest, StrategyManifest, validateManifest } from './lib/strategy'

type Status = 'DRAFT' | 'VALIDATED' | 'ARMED' | 'TRIGGERED' | 'FILLED' | 'WAITING_RESOLUTION' | 'ROLLING' | 'PAUSED' | 'STOPPED'
type ActivityItem = { time: string; title: string; detail: string; kind: 'system' | 'trade' | 'reactivity' | 'success' }
type MarketHealth = { state: 'loading' | 'live' | 'error'; market?: { marketId: string; pool: string; secondsToExpiry: number; bestYesBid: number | null; bestYesAsk: number | null; blockNumber: bigint }; error?: string }

const initialActivity: ActivityItem[] = [
  { time: '18:03:04', title: 'Strategy armed', detail: 'BTC 15m · waiting for trigger', kind: 'system' },
  { time: '18:02:52', title: 'Reactivity subscription active', detail: 'Subscription #1842 · handler verified', kind: 'reactivity' },
  { time: '18:02:49', title: 'Permissions approved', detail: 'placeOrderFor · collateral allowance', kind: 'success' },
]

function App() {
  const [manifest, setManifest] = useState<StrategyManifest>(initialManifest)
  const [status, setStatus] = useState<Status>('DRAFT')
  const [wallet, setWallet] = useState(false)
  const [agentText, setAgentText] = useState('If BTC 15m UP trades above 70%, buy DOWN with 10. Roll half after a win and stop after two losses. Never risk more than 20.')
  const [agentDraft, setAgentDraft] = useState(false)
  const [activity, setActivity] = useState(initialActivity)
  const [activeTab, setActiveTab] = useState<'builder' | 'live'>('builder')
  const [notice, setNotice] = useState('')
  const [marketHealth, setMarketHealth] = useState<MarketHealth>({ state: 'loading' })
  const issues = useMemo(() => validateManifest(manifest), [manifest])
  const riskPercent = Math.min(100, (Number(manifest.policy.maxTotalCapitalAtRisk) / 40) * 100)

  useEffect(() => {
    let cancelled = false
    setMarketHealth({ state: 'loading' })
    void import('./lib/dreamdex/discovery')
      .then(({ discoverTradingMarket }) => discoverTradingMarket({ asset: manifest.series.asset, intervalSec: manifest.series.intervalSec, minSecondsToExpiry: manifest.policy.minSecondsToExpiry }))
      .then((market) => { if (!cancelled) setMarketHealth({ state: 'live', market }) })
      .catch((error: unknown) => { if (!cancelled) setMarketHealth({ state: 'error', error: error instanceof Error ? error.message : String(error) }) })
    return () => { cancelled = true }
  }, [manifest.series.asset, manifest.series.intervalSec, manifest.policy.minSecondsToExpiry])

  const patch = (next: Partial<StrategyManifest>) => setManifest((current) => ({ ...current, ...next }))
  const appendActivity = (item: ActivityItem) => setActivity((items) => [item, ...items])

  const compile = () => {
    const draft = compileIntent(agentText) as StrategyManifest
    setManifest(draft)
    setAgentDraft(true)
    setNotice('AI draft ready. Review every bound before activation.')
    appendActivity({ time: '18:04:10', title: 'Agent draft generated', detail: 'Canonical manifest proposed for review', kind: 'system' })
  }

  const validate = () => {
    if (issues.length) { setNotice(issues[0].message); return }
    setStatus('VALIDATED'); setNotice('Manifest validated. All safety bounds are finite and deterministic.')
    appendActivity({ time: '18:04:14', title: 'Manifest validated', detail: 'Hash 0x7d3a…9c21 · v1 immutable on activation', kind: 'success' })
  }

  const activate = () => {
    if (!wallet) { setNotice('Connect a Somnia wallet before activation.'); return }
    if (issues.length) { setNotice('Resolve validation issues before activation.'); return }
    if (marketHealth.state !== 'live') { setNotice('A verified on-chain Trading market is required before activation.'); return }
    setStatus('ARMED'); setActiveTab('live'); setNotice('Strategy armed on Somnia Shannon Testnet.')
    appendActivity({ time: '18:04:22', title: 'Strategy armed', detail: 'BTC 15m · Reactivity is listening for OrderFilled', kind: 'success' })
  }

  const simulate = () => {
    if (status !== 'ARMED') return
    setStatus('TRIGGERED'); appendActivity({ time: '18:04:31', title: 'Trigger matched', detail: 'Observed UP fill at 0.712 · threshold 0.700', kind: 'reactivity' })
    window.setTimeout(() => { setStatus('FILLED'); appendActivity({ time: '18:04:32', title: 'BUY DOWN filled', detail: '9.74 collateral spent · IOC · tx 0x8b1…3f4', kind: 'trade' }) }, 500)
    window.setTimeout(() => { setStatus('WAITING_RESOLUTION'); appendActivity({ time: '18:04:33', title: 'Waiting for resolution', detail: 'Round 1 · max exposure 9.74 / 20.00', kind: 'system' }) }, 1000)
  }

  const pause = () => { setStatus('PAUSED'); setNotice('Strategy paused. No new orders can be submitted.'); appendActivity({ time: '18:04:40', title: 'Strategy paused', detail: 'User escape hatch · operator remains revocable', kind: 'system' }) }
  const resume = () => { setStatus('ARMED'); setNotice('Strategy resumed.'); appendActivity({ time: '18:04:45', title: 'Strategy resumed', detail: 'Listening for next valid trigger', kind: 'success' }) }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><GitBranch size={17} strokeWidth={2.5} /></div><span>CIRCUIT</span><small>STRATEGY ENGINE</small></div>
      <div className="network"><span className={`pulse ${marketHealth.state}`} /> Somnia Shannon <span className="network-divider" /> <span className="testnet">TESTNET</span></div>
      <div className="top-actions"><button className="icon-button" title="Help"><CircleHelp size={18} /></button><button className={wallet ? 'wallet connected' : 'wallet'} onClick={() => setWallet(!wallet)}><Wallet size={16} />{wallet ? '0x71…A29F' : 'Connect wallet'}</button></div>
    </header>
    <div className="workspace">
      <aside className="sidebar"><div className="eyebrow">CONTROL ROOM</div><nav><button className="nav-item active"><Layers3 size={17} /> Strategies <span className="nav-count">1</span></button><button className="nav-item"><Activity size={17} /> Activity</button></nav><div className="sidebar-divider" /><div className="eyebrow">ENVIRONMENT</div><div className="side-status"><span className={`status-dot ${marketHealth.state === 'live' ? 'green' : marketHealth.state === 'error' ? 'amber' : ''}`} /><div><strong>{marketHealth.state === 'live' ? 'Live market verified' : marketHealth.state === 'error' ? 'Market unavailable' : 'Checking chain truth'}</strong><small>{marketHealth.market ? `Block ${marketHealth.market.blockNumber.toString()} · ${marketHealth.market.marketId.slice(-6)}` : marketHealth.state === 'error' ? 'Activation safely blocked' : 'RPC · dreamDEX indexer'}</small></div></div><div className="sidebar-footer"><LockKeyhole size={14} /> Non-custodial by design</div></aside>
      <main className="main"><div className="page-header"><div><div className="breadcrumb">STRATEGIES <ChevronRight size={14} /> NEW STRATEGY</div><h1>Build a strategy<span className="period">.</span></h1><p>Programmable rules for dreamDEX Event Contracts.</p></div><div className="header-actions"><button className="ghost-button" onClick={() => { setManifest(initialManifest); setStatus('DRAFT'); setNotice('Draft reset.') }}><RefreshCw size={15} /> Reset</button><button className="primary-button" onClick={activate}><Play size={15} fill="currentColor" /> Activate</button></div></div>
        <div className="tabs"><button className={activeTab === 'builder' ? 'tab active' : 'tab'} onClick={() => setActiveTab('builder')}><SlidersHorizontal size={15} /> Builder</button><button className={activeTab === 'live' ? 'tab active' : 'tab'} onClick={() => setActiveTab('live')}><Activity size={15} /> Live activity {status !== 'DRAFT' && <span className="tab-live" />}</button><div className="tab-status"><span className={`status-pill ${status.toLowerCase()}`}><span /> {status.replace('_', ' ')}</span></div></div>
        {notice && <div className="notice"><Sparkles size={15} /><span>{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div>}
        {activeTab === 'builder' ? <div className="builder-grid"><section className="builder-canvas"><div className="section-heading"><div><span className="section-kicker">STRATEGY GRAPH</span><h2>{manifest.name}</h2></div><button className="small-button" title="Copy manifest" onClick={() => navigator.clipboard?.writeText(canonicalManifest(manifest))}><Copy size={14} /> JSON</button></div><div className="graph"><div className="graph-line" /><div className="node start"><div className="node-icon blue"><Clock3 size={16} /></div><div><span className="node-label">MARKET</span><strong>{manifest.series.asset} · {manifest.series.intervalSec === 900 ? '15m' : '1h'}</strong><small>{marketHealth.market ? `live · ${Math.floor(marketHealth.market.secondsToExpiry / 60)}m left · UP ${marketHealth.market.bestYesBid ?? '—'} / ${marketHealth.market.bestYesAsk ?? '—'}` : marketHealth.state === 'error' ? 'no eligible on-chain market' : 'resolving live window…'}</small></div>{marketHealth.state === 'live' && <Check size={15} className="node-check" />}</div><div className="connector"><span>WHEN</span></div><div className="node condition"><div className="node-icon amber"><Activity size={16} /></div><div><span className="node-label">TRIGGER</span><strong>UP last fill <em>{manifest.trigger.type === 'LAST_FILL_PRICE_ABOVE' ? '>' : '<'} {manifest.trigger.value}</em></strong><small>on-chain OrderFilled event</small></div><span className="yes-chip">YES</span></div><div className="connector"><span>THEN</span></div><div className="node action"><div className="node-icon red"><ArrowDownToLine size={16} /></div><div><span className="node-label">ACTION</span><strong>{manifest.action.type === 'BUY_DOWN' ? 'BUY DOWN' : 'BUY UP'} <em>· max {manifest.action.maxCollateral}</em></strong><small>IOC · {manifest.action.maxSlippageBps} bps max slippage</small></div><Check size={15} className="node-check" /></div><div className="connector split"><span>ON RESOLUTION</span></div><div className="branch-grid"><div className="branch win"><div className="branch-title"><span className="branch-dot" /> WIN</div><strong>ROLL {manifest.resolution.onWin.rollPercent}%</strong><small>realized proceeds only</small><div className="branch-arrow">↘</div></div><div className="branch loss"><div className="branch-title"><span className="branch-dot" /> LOSS</div><strong>LOSSES + 1</strong><small>stop at {manifest.policy.stopAfterConsecutiveLosses}</small><div className="branch-arrow">↙</div></div></div><div className="merge-connector" /><div className="node next"><div className="node-icon green"><ArrowUpFromLine size={16} /></div><div><span className="node-label">CONTINUE</span><strong>NEXT WINDOW</strong><small>re-resolve live market binding</small></div><Check size={15} className="node-check" /></div></div><div className="graph-footer"><span><span className="legend-dot green" /> deterministic</span><span><span className="legend-dot amber" /> event-driven</span><span><LockKeyhole size={12} /> no arbitrary calls</span></div></section>
          <aside className="config-column"><div className="panel config-panel"><div className="panel-heading"><div><span className="section-kicker">CONFIGURATION</span><h3>Strategy parameters</h3></div><Code2 size={17} /></div><label>Strategy name<input value={manifest.name} onChange={(e) => patch({ name: e.target.value })} /></label><div className="field-row"><label>Asset<select value={manifest.series.asset} onChange={(e) => patch({ series: { ...manifest.series, asset: e.target.value as 'BTC' | 'ETH' } })}><option>BTC</option><option>ETH</option></select></label><label>Cadence<select value={manifest.series.intervalSec} onChange={(e) => patch({ series: { ...manifest.series, intervalSec: Number(e.target.value) as 900 | 3600 } })}><option value="900">15 min</option><option value="3600">1 hour</option></select></label></div><div className="field-row"><label>Trigger threshold<div className="input-suffix"><input value={manifest.trigger.value} onChange={(e) => patch({ trigger: { ...manifest.trigger, value: e.target.value } })} /><span>UP prob.</span></div></label><label>Side<select value={manifest.action.type} onChange={(e) => patch({ action: { ...manifest.action, type: e.target.value as 'BUY_UP' | 'BUY_DOWN' } })}><option value="BUY_DOWN">Buy DOWN</option><option value="BUY_UP">Buy UP</option></select></label></div><div className="field-row"><label>Max order<input value={manifest.action.maxCollateral} onChange={(e) => patch({ action: { ...manifest.action, maxCollateral: e.target.value } })} /></label><label>Hard cap<input value={manifest.policy.maxTotalCapitalAtRisk} onChange={(e) => patch({ policy: { ...manifest.policy, maxTotalCapitalAtRisk: e.target.value } })} /></label></div><div className="field-row"><label>Roll after win<div className="input-suffix"><input value={manifest.resolution.onWin.rollPercent} onChange={(e) => patch({ resolution: { ...manifest.resolution, onWin: { rollPercent: Number(e.target.value) } } })} /><span>%</span></div></label><label>Stop after losses<input value={manifest.policy.stopAfterConsecutiveLosses} onChange={(e) => patch({ policy: { ...manifest.policy, stopAfterConsecutiveLosses: Number(e.target.value) } })} /></label></div><button className="add-rule"><Plus size={14} /> Add rule</button></div><div className="panel risk-panel"><div className="panel-heading"><div><span className="section-kicker">RISK PREVIEW</span><h3>Bounded by design</h3></div><ShieldCheck size={18} className="shield" /></div><div className="risk-meter"><div className="risk-meter-top"><span>Capital at risk</span><strong>{manifest.policy.maxTotalCapitalAtRisk} <small>/ 40 suggested</small></strong></div><div className="meter"><span style={{ width: `${riskPercent}%` }} /></div></div><div className="risk-list"><div><Check size={14} /><span>Per-order limit</span><strong>{manifest.action.maxCollateral}</strong></div><div><Check size={14} /><span>Round limit</span><strong>{manifest.policy.maxRounds} rounds</strong></div><div><Check size={14} /><span>Expiry buffer</span><strong>{manifest.policy.minSecondsToExpiry}s</strong></div><div><Check size={14} /><span>Slippage cap</span><strong>{manifest.action.maxSlippageBps} bps</strong></div><div><Check size={14} /><span>Chain truth</span><strong>{marketHealth.state === 'live' ? 'Trading' : marketHealth.state === 'loading' ? 'Checking' : 'Blocked'}</strong></div></div><div className="risk-callout"><LockKeyhole size={14} /><span>Circuit can only execute this approved manifest. Limits are immutable after activation.</span></div></div><div className="panel agent-panel"><div className="agent-heading"><div className="agent-icon"><Bot size={16} /></div><div><span className="section-kicker">SOMNIA AGENT</span><h3>Describe your intent</h3></div><span className="draft-badge">{agentDraft ? 'DRAFT READY' : 'OPTIONAL'}</span></div><textarea value={agentText} onChange={(e) => setAgentText(e.target.value)} /><button className="agent-button" onClick={compile}><Sparkles size={14} /> Compile to strategy</button><small className="agent-note">AI-generated draft · review before activation</small></div></aside></div> : <div className="live-view"><div className="live-summary"><div><span className="section-kicker">LIVE STRATEGY</span><h2>{manifest.name}</h2><p>{manifest.series.asset} {manifest.series.intervalSec === 900 ? '15m' : '1h'} · Round 1 of {manifest.policy.maxRounds}</p></div><div className="live-controls">{status === 'PAUSED' ? <button className="primary-button" onClick={resume}><Play size={15} fill="currentColor" /> Resume</button> : status !== 'STOPPED' && <button className="danger-button" onClick={pause}><Pause size={15} /> Emergency pause</button>}<button className="ghost-button" onClick={simulate} disabled={status !== 'ARMED'}><Sparkles size={15} /> Simulate trigger</button></div></div><div className="live-grid"><div className="panel state-panel"><div className="state-orbit"><div className="orbit-ring" /><div className="orbit-core"><span className={`status-dot ${status === 'PAUSED' ? 'amber' : 'green'}`} /><strong>{status.replace('_', ' ')}</strong><small>current state</small></div></div><div className="state-metrics"><div><span>Observed UP</span><strong>{marketHealth.market?.bestYesAsk ?? '—'}</strong></div><div><span>Capital at risk</span><strong>0.00 <small>/ {manifest.policy.maxTotalCapitalAtRisk}</small></strong></div><div><span>Consecutive losses</span><strong>0 <small>/ {manifest.policy.stopAfterConsecutiveLosses}</small></strong></div></div><div className="next-action"><span className="section-kicker">NEXT EXPECTED ACTION</span><strong>{status === 'ARMED' ? 'Wait for UP fill above threshold' : status === 'PAUSED' ? 'Resume strategy to continue' : 'Waiting for market resolution'}</strong><ExternalLink size={14} /></div></div><div className="panel activity-panel"><div className="panel-heading"><div><span className="section-kicker">ACTIVITY TIMELINE</span><h3>Everything accounted for</h3></div><span className="live-badge"><span /> LIVE</span></div><div className="timeline">{activity.map((item, i) => <div className="timeline-item" key={`${item.time}-${i}`}><div className={`timeline-icon ${item.kind}`}><span>{item.kind === 'trade' ? '↙' : item.kind === 'reactivity' ? '✦' : item.kind === 'success' ? '✓' : '·'}</span></div><div className="timeline-copy"><div><strong>{item.title}</strong><time>{item.time}</time></div><p>{item.detail}</p>{item.kind === 'trade' && <a href="https://shannon-explorer.somnia.network" target="_blank" rel="noreferrer"><Link2 size={12} /> View transaction</a>}</div></div>)}</div></div></div></div>}
      </main>
    </div>
  </div>
}

export default App
