import { canonicalManifest, validateManifest, type StrategyManifest } from './strategy'

export const nodeKinds = ['MARKET','CONDITION','BUY','WIN_LOSS','ROLL','STOP'] as const
export type NodeKind = typeof nodeKinds[number]
export interface ProgramNode { id:string; kind:NodeKind; data:Record<string,unknown>; x:number; y:number }
export interface ProgramEdge { from:string; port:string; to:string }
export interface StrategyGraph { version:1; name:string; nodes:ProgramNode[]; edges:ProgramEdge[] }
export const ports:Record<NodeKind,string[]>={MARKET:['next'],CONDITION:['match'],BUY:['resolved'],WIN_LOSS:['win','loss','void'],ROLL:['next'],STOP:['next']}
const routes:[NodeKind,string,NodeKind][]=[['MARKET','next','CONDITION'],['CONDITION','match','BUY'],['BUY','resolved','WIN_LOSS'],['WIN_LOSS','win','ROLL'],['WIN_LOSS','loss','STOP'],['WIN_LOSS','void','STOP'],['ROLL','next','STOP'],['STOP','next','MARKET']]
export function manifestGraph(manifest:StrategyManifest):StrategyGraph {
 const {sizing,...buy}=manifest.action
 const data:Record<NodeKind,Record<string,unknown>>={MARKET:{...manifest.series},CONDITION:{...manifest.trigger},BUY:{...buy},WIN_LOSS:{...manifest.resolution.onLoss,...manifest.resolution.onVoid},ROLL:{...manifest.resolution.onWin,...(sizing?{sizing}:{})},STOP:{...manifest.policy}}
 return {version:1,name:manifest.name,nodes:nodeKinds.map((kind,i)=>({id:kind.toLowerCase(),kind,data:data[kind],x:kind==='ROLL'?300:40,y:kind==='ROLL'?440:i===5?590:30+i*135})),edges:routes.map(([from,port,to])=>({from:from.toLowerCase(),port,to:to.toLowerCase()}))}
}
/** Coordinates do not change the authorized trading program. */
export function isGraphDocument(value:unknown):value is StrategyGraph {
 const graph=value as StrategyGraph
 return !!graph&&graph.version===1&&typeof graph.name==='string'&&Array.isArray(graph.nodes)&&Array.isArray(graph.edges)
  &&graph.nodes.every(n=>!!n&&typeof n.id==='string'&&nodeKinds.includes(n.kind)&&!!n.data&&typeof n.data==='object'&&Number.isFinite(n.x)&&Number.isFinite(n.y))
  &&graph.edges.every(e=>!!e&&typeof e.from==='string'&&typeof e.to==='string'&&typeof e.port==='string')
}
export function graphKey(graph:StrategyGraph):string {
 return JSON.stringify({version:graph.version,name:graph.name,nodes:graph.nodes.map(({id,kind,data})=>({id,kind,data})).sort((a,b)=>a.id.localeCompare(b.id)),edges:[...graph.edges].sort((a,b)=>`${a.from}:${a.port}:${a.to}`.localeCompare(`${b.from}:${b.port}:${b.to}`))})
}
export function updateGraphRules(graph:StrategyGraph,manifest:StrategyManifest):StrategyGraph {
 const source=manifestGraph(manifest)
 return {...graph,name:manifest.name,nodes:graph.nodes.map(node=>({...node,data:source.nodes.find(n=>n.kind===node.kind)!.data}))}
}
export type GraphCompilation={ok:true;manifest:StrategyManifest;program:string}|{ok:false;errors:string[]}
/** Compile only engine-supported control flow. Unsupported edges never disappear silently. */
export function compileGraph(input:unknown):GraphCompilation {
 const errors:string[]=[]
 const graph=input as StrategyGraph
 if(!graph||graph.version!==1||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))return {ok:false,errors:['Invalid graph document.']}
 if(graph.nodes.some(n=>!n||typeof n.id!=='string'||!nodeKinds.includes(n.kind)||!n.data||typeof n.data!=='object'))return {ok:false,errors:['Unknown or malformed node.']}
 if(new Set(graph.nodes.map(n=>n.id)).size!==graph.nodes.length)errors.push('Node IDs must be unique.')
 for(const kind of nodeKinds)if(graph.nodes.filter(n=>n.kind===kind).length!==1)errors.push(`Add exactly one ${kind} node.`)
 if(graph.edges.some(e=>!e||typeof e.from!=='string'||typeof e.to!=='string'||typeof e.port!=='string'))return {ok:false,errors:['Malformed connection.']}
 for(const edge of graph.edges){const from=graph.nodes.find(n=>n.id===edge.from),to=graph.nodes.find(n=>n.id===edge.to);if(!from||!to||!routes.some(([a,p,b])=>a===from.kind&&p===edge.port&&b===to.kind))errors.push(`Unsupported connection: ${edge.from} / ${edge.port} → ${edge.to}.`)}
 for(const [from,port,to]of routes){const origins=graph.nodes.filter(n=>n.kind===from);if(origins.length===1&&graph.edges.filter(e=>e.from===origins[0].id&&e.port===port&&graph.nodes.find(n=>n.id===e.to)?.kind===to).length!==1)errors.push(`Connect ${from}.${port} to ${to} exactly once.`)}
 if(errors.length)return {ok:false,errors}
 const data=(kind:NodeKind)=>graph.nodes.find(n=>n.kind===kind)!.data
 const manifest={version:1,name:graph.name,series:data('MARKET'),trigger:data('CONDITION'),action:{...data('BUY'),...(data('ROLL').sizing?{sizing:data('ROLL').sizing}:{})},resolution:{onWin:{rollPercent:data('ROLL').rollPercent},onLoss:{incrementConsecutiveLosses:data('WIN_LOSS').incrementConsecutiveLosses},onVoid:{treatAsLoss:data('WIN_LOSS').treatAsLoss,treatAsWin:data('WIN_LOSS').treatAsWin}},policy:data('STOP')} as unknown as StrategyManifest
 const issues=validateManifest(manifest)
 if(issues.length)return {ok:false,errors:issues.map(issue=>issue.message)}
 // Normalize through the canonical serializer; this is the document hashed for authorization.
 const normalized=JSON.parse(canonicalManifest(manifest)) as StrategyManifest
 return {ok:true,manifest:normalized,program:`price_${manifest.trigger.type==='LAST_FILL_PRICE_ABOVE'?'above':'below'}(${manifest.trigger.value}) → buy(${manifest.action.type==='BUY_UP'?'UP':'DOWN'},${manifest.action.maxCollateral}) → on_win(${manifest.action.sizing?`increase ${manifest.action.sizing.incrementCollateral}, start ${manifest.action.sizing.initialCollateral}, max ${manifest.action.maxCollateral}`:`roll ${manifest.resolution.onWin.rollPercent}%`}) → stop_after_losses(${manifest.policy.stopAfterConsecutiveLosses})`}
}
