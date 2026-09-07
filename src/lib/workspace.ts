import { isGraphDocument, type StrategyGraph } from './graph'
import { initialManifest, validateManifest, type StrategyManifest } from './strategy'

export interface LocalDraft { id:string; manifest:StrategyManifest; updatedAt:string; graph?:StrategyGraph; compiledGraphKey?:string }
export const DRAFTS_KEY='circuit.workspace.drafts.v2'
export const INTRO_KEY='circuit.intro.seen.v2'
export const templateCatalog=[
  {id:'contrarian',name:'Contrarian Roller',tag:'A different perspective',description:'Buy DOWN when UP crosses your threshold. Carry a portion of winning proceeds forward.',asset:'BTC',color:'mint',manifest:initialManifest},
  {id:'ladder',name:'Conditional Ladder',tag:'Advance only on wins',description:'Start at 5 tUSDC. Each win adds 2.5, up to 10 per order. The first loss ends the program.',asset:'BTC',color:'peach',manifest:{...initialManifest,name:'Conditional Ladder',series:{asset:'BTC',intervalSec:900},trigger:{type:'LAST_FILL_PRICE_BELOW',value:'0.400'},action:{type:'BUY_UP',maxCollateral:'10',maxSlippageBps:200,sizing:{mode:'WIN_LADDER',initialCollateral:'5',incrementCollateral:'2.5'}},resolution:{...initialManifest.resolution,onWin:{rollPercent:100}},policy:{maxTotalCapitalAtRisk:'25',maxRounds:3,stopAfterConsecutiveLosses:1,minSecondsToExpiry:120}} as StrategyManifest},
  {id:'streak',name:'Bounded Streak',tag:'Follow a winning streak',description:'Buy UP above 60%. Reuse half of redeemed wins, stop on the first loss, and never spend more than 12 tUSDC.',asset:'ETH',color:'lavender',manifest:{...initialManifest,name:'Bounded Streak',series:{asset:'ETH',intervalSec:900},trigger:{type:'LAST_FILL_PRICE_ABOVE',value:'0.600'},action:{type:'BUY_UP',maxCollateral:'3',maxSlippageBps:100},policy:{maxTotalCapitalAtRisk:'12',maxRounds:4,stopAfterConsecutiveLosses:1,minSecondsToExpiry:120}} as StrategyManifest},
] as const
export function makeDraft(templateId:string='contrarian'):LocalDraft {
 const template=templateCatalog.find(item=>item.id===templateId)??templateCatalog[0]
 return {id:crypto.randomUUID(),manifest:structuredClone(template.manifest),updatedAt:new Date().toISOString()}
}
export function parseDrafts(raw:string|null):LocalDraft[]{
 try{const parsed=JSON.parse(raw??'[]');if(!Array.isArray(parsed))return []
 return parsed.filter((draft):draft is LocalDraft=>typeof draft?.id==='string' && /^[\w-]+$/.test(draft.id) && typeof draft.updatedAt==='string' && Number.isFinite(Date.parse(draft.updatedAt)) && !validateManifest(draft.manifest).length).map(draft=>({...draft,graph:isGraphDocument(draft.graph)?draft.graph:undefined,compiledGraphKey:isGraphDocument(draft.graph)&&typeof draft.compiledGraphKey==='string'?draft.compiledGraphKey:undefined}))
 }catch{return []}
}
export function friendlyStatus(status:number){return ['Not created','Ready to activate','Watching the market','Signal matched','Submitting order','Awaiting resolution','Finding next window','Paused','Finished','Stopped'][status]??'Checking state'}
export function formatTime(value:string){return new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
