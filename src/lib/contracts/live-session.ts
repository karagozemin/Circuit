import { isAddress, type Address, type Hex } from 'viem'
import { validateManifest, type StrategyManifest } from '../strategy'
export const LIVE_SESSION_KEY='circuit.live-strategy.v1'
export interface LiveSession {
  chainId:50312; engine:Address; owner:Address; strategyId:Hex;
  manifest:StrategyManifest; subscriptions:string[]; fromBlock:string;
}
/** Browser data is a recovery hint; callers must verify its manifest hash and owner on chain. */
export function parseLiveSession(text:string|null):LiveSession|undefined {
  try {
    if(!text)return
    const value=JSON.parse(text)
    if(value?.chainId!==50312 || !isAddress(value.engine) || !isAddress(value.owner)
      || !/^0x[\da-f]{64}$/i.test(value.strategyId) || validateManifest(value.manifest).length
      || !Array.isArray(value.subscriptions) || value.subscriptions.length!==3
      || !value.subscriptions.every((id:unknown)=>typeof id==='string' && /^\d+$/.test(id))
      || typeof value.fromBlock!=='string' || !/^\d+$/.test(value.fromBlock))return
    return value as LiveSession
  }catch{return}
}
