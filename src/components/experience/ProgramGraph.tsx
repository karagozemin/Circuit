import { useState } from 'react'
import { ArrowRight, Code2, Download, Plus, Trash2 } from 'lucide-react'
import { compileGraph, manifestGraph, nodeKinds, ports, type NodeKind, type StrategyGraph } from '../../lib/graph'
import type { StrategyManifest } from '../../lib/strategy'
import type { RuleSection } from './shared'
const sections:Record<NodeKind,RuleSection>={MARKET:'market',CONDITION:'entry',BUY:'entry',WIN_LOSS:'risk',ROLL:'risk',STOP:'risk'}
function nodeSummary(node:StrategyGraph['nodes'][number],manifest:StrategyManifest):string {
 const d=node.data
 switch(node.kind){
  case 'MARKET':return `${d.asset} · ${Number(d.intervalSec)/60} min windows`
  case 'CONDITION':return `UP fill price ${d.type==='LAST_FILL_PRICE_ABOVE'?'>':'<'} ${d.value}`
  case 'BUY':return `Buy ${d.type==='BUY_UP'?'UP':'DOWN'} · up to ${d.maxCollateral} tUSDC`
  case 'WIN_LOSS':return 'Win → progress · loss → stop check · void stays neutral'
  case 'ROLL':{const sizing=d.sizing as StrategyManifest['action']['sizing'];return sizing?`Start ${sizing.initialCollateral} · +${sizing.incrementCollateral} per win · max ${manifest.action.maxCollateral} tUSDC`:`Roll ${d.rollPercent}% of redeemed wins`}
  case 'STOP':return `Cap ${d.maxTotalCapitalAtRisk} tUSDC · ${d.maxRounds} rounds · stop at ${d.stopAfterConsecutiveLosses} loss(es)`
 }
}
export function ProgramGraph({graph,manifest,onChange,onSelect,onCompile,compiled}:{graph:StrategyGraph;manifest:StrategyManifest;onChange:(graph:StrategyGraph)=>void;onSelect:(section:RuleSection)=>void;onCompile:()=>void;compiled:boolean}) {
 const [selected,setSelected]=useState<string>()
 const [kind,setKind]=useState<NodeKind>('CONDITION')
 const node=graph.nodes.find(n=>n.id===selected)
 const result=compileGraph(graph)
 const height=Math.max(760,...graph.nodes.map(n=>n.y+150))
 const exportGraph=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(graph,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='circuit-program.graph.json';link.click();URL.revokeObjectURL(url)}
 const add=()=>{const source=manifestGraph(manifest).nodes.find(n=>n.kind===kind)!;const id=crypto.randomUUID();onChange({...graph,nodes:[...graph.nodes,{...source,id,x:300,y:height-100}]});setSelected(id)}
 const move=(id:string,x:number,y:number)=>onChange({...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,x:Math.max(8,Math.min(370,x)),y:Math.max(10,y)}:n)})
 return <div className="program-editor"><div className="program-toolbar"><label>Node<select aria-label="Node type" value={kind} onChange={e=>setKind(e.target.value as NodeKind)}>{nodeKinds.map(k=><option key={k}>{k}</option>)}</select></label><button className="btn btn-white btn-sm" onClick={add}><Plus size={14}/> Add node</button><button className="btn btn-primary btn-sm" onClick={onCompile}><Code2 size={14}/> Compile graph</button><button className="icon-btn" aria-label="Download graph JSON" onClick={exportGraph}><Download size={15}/></button></div><p className="program-hint">Select a node to edit its rules and connections. Drag its handle to arrange it. STOP checks limits before the next market.</p>
 <div className="program-scroll"><div className="program-board" style={{height}}>
 <svg className="program-wires" width="620" height={height} aria-label="Program connections"><defs><marker id="program-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="var(--accent)"/></marker></defs>{graph.edges.map((edge,i)=>{const from=graph.nodes.find(n=>n.id===edge.from),to=graph.nodes.find(n=>n.id===edge.to);if(!from||!to)return null;const loop=from.kind==='STOP';return <g key={`${edge.from}-${edge.port}-${i}`}><path d={loop?`M ${from.x+105} ${from.y+80} C 610 ${from.y+140}, 610 0, ${to.x+105} ${to.y}`:`M ${from.x+105} ${from.y+80} C ${from.x+105} ${from.y+110}, ${to.x+105} ${to.y-30}, ${to.x+105} ${to.y}`} markerEnd="url(#program-arrow)"/><text x={loop?500:from.x+115} y={from.y+99+i%3*12}>{edge.port}</text></g>})}</svg>
 {graph.nodes.map(n=><div className={`program-node ${selected===n.id?'selected':''}`} key={n.id} style={{left:n.x,top:n.y}}><button className="node-handle" aria-label={`Move ${n.kind} node`} onKeyDown={e=>{const delta:Record<string,[number,number]>={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};if(delta[e.key]){e.preventDefault();move(n.id,n.x+delta[e.key][0],n.y+delta[e.key][1])}}} onPointerDown={e=>{const target=e.currentTarget,startX=e.clientX,startY=e.clientY;target.setPointerCapture(e.pointerId);const drag=(event:PointerEvent)=>move(n.id,n.x+event.clientX-startX,n.y+event.clientY-startY);const end=()=>{target.removeEventListener('pointermove',drag);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end)};target.addEventListener('pointermove',drag);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end)}}>⠿</button><button className="node-select" onClick={()=>{setSelected(n.id);onSelect(sections[n.kind])}}><strong>{n.kind.replace('_',' / ')}</strong><small title={nodeSummary(n,manifest)}>{nodeSummary(n,manifest)}</small></button></div>)}
 </div></div>
 {node&&<div className="node-connections"><div><strong>{node.kind.replace('_',' / ')} connections</strong><button className="icon-btn" aria-label={`Remove ${node.kind} node`} onClick={()=>{onChange({...graph,nodes:graph.nodes.filter(n=>n.id!==node.id),edges:graph.edges.filter(e=>e.from!==node.id&&e.to!==node.id)});setSelected(undefined)}}><Trash2 size={15}/></button></div>{ports[node.kind].map(port=><label key={port}>{port}<ArrowRight size={13}/><select aria-label={`${node.kind} ${port} target`} value={graph.edges.find(e=>e.from===node.id&&e.port===port)?.to??''} onChange={e=>onChange({...graph,edges:[...graph.edges.filter(edge=>!(edge.from===node.id&&edge.port===port)),...(e.target.value?[{from:node.id,port,to:e.target.value}]:[])]})}><option value="">Not connected</option>{graph.nodes.map(n=><option key={n.id} value={n.id}>{n.kind} · {n.id.slice(0,8)}</option>)}</select></label>)}</div>}
 <div className={`program-compile-status ${compiled?'compiled':''}`} role="status"><strong>{compiled?'Compiled · ready for review':result.ok?'Graph ready · compile to review':'Graph needs attention'}</strong>{result.ok?<code>{result.program}</code>:<ul>{result.errors.map((error,i)=><li key={i}>{error}</li>)}</ul>}</div></div>
}
