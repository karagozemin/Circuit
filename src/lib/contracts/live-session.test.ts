import { expect, it } from 'vitest'
import { parseLiveSession } from './live-session'
import { initialManifest } from '../strategy'
it('recovers only complete bounded manifests with valid public identifiers',()=>{
 const session={chainId:50312,engine:'0x'+'1'.repeat(40),owner:'0x'+'2'.repeat(40),strategyId:'0x'+'3'.repeat(64),manifest:initialManifest,subscriptions:['1','2','3'],fromBlock:'500'}
 expect(parseLiveSession(JSON.stringify(session))).toEqual(session)
 for(const malformed of [{...session,chainId:1},{...session,manifest:{...initialManifest,policy:{}}},{...session,subscriptions:['1']},{...session,fromBlock:'-1'}])expect(parseLiveSession(JSON.stringify(malformed))).toBeUndefined()
 expect(parseLiveSession('{')).toBeUndefined()
})
