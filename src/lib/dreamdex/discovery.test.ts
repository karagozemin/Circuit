import { describe, expect, it } from 'vitest'
import { isMarketEligible } from './discovery'

describe('dreamDEX chain-truth gate', () => {
  it('accepts a Trading market outside the expiry buffer', () => {
    expect(isMarketEligible({ status: 1, expiry: 1_500n }, 1_000, 120)).toBe(true)
  })

  it('rejects an indexer Trading row when the chain says Locked', () => {
    expect(isMarketEligible({ status: 2, expiry: 1_500n }, 1_000, 120)).toBe(false)
  })

  it('rejects a Trading market too close to expiry', () => {
    expect(isMarketEligible({ status: 1, expiry: 1_100n }, 1_000, 120)).toBe(false)
  })
})

