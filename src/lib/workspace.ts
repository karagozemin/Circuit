import { initialManifest, validateManifest, type StrategyManifest } from './strategy'

export interface LocalDraft { id:string; manifest:StrategyManifest; updatedAt:string }
export const DRAFTS_KEY='circuit.workspace.drafts.v2'
export const INTRO_KEY='circuit.intro.seen.v2'
export const templateCatalog=[
  {id:'contrarian',name:'Contrarian Roller',tag:'A different perspective',description:'Buy DOWN when UP crosses your threshold. Carry a portion of winning proceeds forward.',asset:'BTC',color:'mint',manifest:initialManifest},
  {id:'momentum',name:'Momentum Follow',tag:'Follow your conviction',description:'Buy UP above your chosen threshold, with a smaller order and a clear three-round limit.',asset:'BTC',color:'peach',manifest:{...initialManifest,name:'Momentum Follow',trigger:{type:'LAST_FILL_PRICE_ABOVE',value:'0.600'},action:{type:'BUY_UP',maxCollateral:'5',maxSlippageBps:200},policy:{maxTotalCapitalAtRisk:'15',maxRounds:3,stopAfterConsecutiveLosses:2,minSecondsToExpiry:120}} as StrategyManifest},
  {id:'patient',name:'Patient Entry',tag:'Wait for your moment',description:'Buy UP below your threshold. Keep your order small and your lifetime spending bounded.',asset:'ETH',color:'lavender',manifest:{...initialManifest,name:'Patient Entry',series:{asset:'ETH',intervalSec:900},trigger:{type:'LAST_FILL_PRICE_BELOW',value:'0.400'},action:{type:'BUY_UP',maxCollateral:'2',maxSlippageBps:100},policy:{maxTotalCapitalAtRisk:'6',maxRounds:3,stopAfterConsecutiveLosses:1,minSecondsToExpiry:120}} as StrategyManifest},
] as const
export function makeDraft(templateId:string='contrarian'):LocalDraft {
 const template=templateCatalog.find(item=>item.id===templateId)??templateCatalog[0]
 return {id:crypto.randomUUID(),manifest:structuredClone(template.manifest),updatedAt:new Date().toISOString()}
}
export function parseDrafts(raw:string|null):LocalDraft[]{
 try{const parsed=JSON.parse(raw??'[]');if(!Array.isArray(parsed))return []
 return parsed.filter((draft):draft is LocalDraft=>typeof draft?.id==='string' && /^[\w-]+$/.test(draft.id) && typeof draft.updatedAt==='string' && Number.isFinite(Date.parse(draft.updatedAt)) && !validateManifest(draft.manifest).length)
 }catch{return []}
}
export function friendlyStatus(status:number){return ['Not created','Ready to activate','Watching the market','Signal matched','Submitting order','Awaiting resolution','Finding next window','Paused','Finished','Stopped'][status]??'Checking state'}
export function formatTime(value:string){return new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
