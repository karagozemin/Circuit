import { Check, Clock3, ExternalLink } from 'lucide-react'
import { formatUnits } from 'viem'
import type { Circuit } from '../../hooks/useCircuit'
import { manifestHash } from '../../lib/contracts/engine'
import { friendlyStatus } from '../../lib/workspace'
export function ExecutionProgram({circuit}:{circuit:Circuit}) {
 const {session,runtime,activity,subscriptionProofs,verifiedAt}=circuit
 if(!session)return null
 const events=activity.filter(entry=>entry.strategyId===session.strategyId&&entry.hash&&entry.eventName)
 const event=(name:string)=>events.find(entry=>entry.eventName===name)
 const bound=events.find(entry=>entry.eventName==='MarketBound'&&Number(entry.eventArgs?.round)>1)
 const resolved=events.find(entry=>entry.eventName==='RoundResolved'&&Number(entry.eventArgs?.result)!==3)
 const filled=event('OrderExecuted')
 const stages=[
  {label:'Strategy compiled',done:runtime?.manifestHash===manifestHash(session.manifest),detail:'Approved manifest hash verified against the Engine. Compilation happens locally.',receipt:event('StrategyCreated')},
  {label:'Subscription active',done:session.subscriptions.length===3&&session.subscriptions.every(id=>subscriptionProofs.some(s=>s.id===id&&s.healthy)),detail:'Initial fill, resolution and creator subscriptions checked on chain. Keeper availability is separate.'},
  {label:'Trigger matched',done:!!event('TriggerMatched'),detail:'A verified fill satisfied the approved condition.',receipt:event('TriggerMatched')},
  {label:'DreamDEX order filled',done:!!filled,detail:filled?.detail??'Waiting for a real fill receipt.',receipt:filled},
  {label:'Market resolved',done:!!resolved,detail:resolved?.detail??'Waiting for verified settlement; skipped windows do not count.',receipt:resolved},
  {label:'Next node executed',done:!!bound,detail:'Next MARKET node: a successor window was bound. This alone does not mean another order filled.',receipt:bound},
 ]
 const next=runtime?({1:'Authorize activation',2:'Wait for a matching fill',3:'Keeper submits bounded order',4:'Await order receipt',5:'Await resolution',6:'Verify and bind next market',7:'Owner resumes or ends circuit',8:'Program finished',9:'Program ended'} as Record<number,string>)[runtime.status]:'Verify chain state'
 return <section className="execution-program"><h2>Compose → Compile → Execute → React</h2><p>DreamDEX resolution → Somnia Reactivity → Circuit state transition → next action</p>
 <dl className="execution-metrics"><div><dt>Current State</dt><dd>{runtime?friendlyStatus(runtime.status):'Verifying'}</dd></div><div><dt>Capital at Risk · maximum</dt><dd>{session.manifest.policy.maxTotalCapitalAtRisk} tUSDC</dd></div><div><dt>Max Rounds</dt><dd>{session.manifest.policy.maxRounds}</dd></div><div><dt>Losses</dt><dd>{runtime?.consecutiveLosses??'—'} / {session.manifest.policy.stopAfterConsecutiveLosses}</dd></div><div><dt>Current Market</dt><dd>{session.manifest.series.asset} {session.manifest.series.intervalSec/60}m {runtime&&<a href={`https://shannon-explorer.somnia.network/address/${runtime.currentMarket}`} target="_blank" rel="noreferrer" aria-label="Inspect current market"><ExternalLink size={12}/></a>}</dd></div><div><dt>Last Action · observed on chain</dt><dd>{events[0]?.title??'No event in the loaded history'}</dd></div><div><dt>Next Action</dt><dd>{next}</dd></div><div><dt>Next Order · budget ceiling</dt><dd>{runtime?formatUnits(runtime.nextOrderBudget,6):'—'} tUSDC</dd></div></dl>
 <ol className="execution-proof-list">{stages.map(stage=><li key={stage.label}><strong>{stage.done?<Check size={15}/>:<Clock3 size={15}/>} {stage.label}</strong><small>{stage.done?'Verified':'Not yet verified'} · {stage.detail}</small>{stage.receipt?.hash&&<a href={`https://shannon-explorer.somnia.network/tx/${stage.receipt.hash}`} target="_blank" rel="noreferrer">View receipt <ExternalLink size={12}/></a>}</li>)}</ol>
 <details className="subscription-evidence"><summary>Subscription IDs & evidence</summary><p>Last state verification: {verifiedAt?new Date(verifiedAt).toLocaleTimeString():'pending'}. Event history is bounded; missing evidence stays unverified.</p><ul>{session.subscriptions.map((id,i)=>{const proof=subscriptionProofs.find(p=>p.id===id);return <li key={id}>{['OrderFilled','StatusChanged / resolution','MarketCreated / successor'][i]} · subscription <code>#{id}</code> · {proof?.healthy?'verified and funded':'not verified'}{proof?.emitter&&<> · <a href={`https://shannon-explorer.somnia.network/address/${proof.emitter}`} target="_blank" rel="noreferrer">Inspect emitter</a></>}</li>})}</ul></details></section>
}
