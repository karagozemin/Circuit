import { describe, expect, it } from 'vitest'
import { normalizeSubscriptionInfo } from './subscription-info'
const owner='0x1111111111111111111111111111111111111111'
const data={handlerContractAddress:'0x2222222222222222222222222222222222222222',emitter:owner,eventTopics:['0x'+'a'.repeat(64)]}
describe('real subscription result compatibility',()=>{
  it('accepts the tuple returned by the Shannon precompile',()=>{
    expect(normalizeSubscriptionInfo([data,owner])).toEqual({subscriptionData:data,owner})
  })
  it('accepts the named SDK shape and rejects missing/deleted records',()=>{
    expect(normalizeSubscriptionInfo({subscriptionData:data,owner}).owner).toBe(owner)
    for(const value of [undefined,{},[],[{},owner],new Error('SubscriptionNotFound')])expect(()=>normalizeSubscriptionInfo(value)).toThrow()
  })
})
