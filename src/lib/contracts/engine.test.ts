import { describe, expect, it } from 'vitest'
import { initialManifest, canonicalManifest } from '../strategy'
import { manifestHash, manifestToEngineConfig } from './engine'

describe('CircuitEngine manifest encoding', () => {
  it('uses fixed-point integers for all monetary values', () => {
    expect(manifestToEngineConfig(initialManifest)).toMatchObject({
      assetId: 0,
      intervalSec: 900,
      triggerValue: 700_000n,
      actionType: 1,
      maxOrderCollateral: 10_000_000n,
      maxTotalCapitalAtRisk: 20_000_000n,
      rollPercentBps: 5_000,
    })
  })

  it('canonicalizes key order before hashing', () => {
    const reordered = Object.fromEntries(Object.entries(initialManifest).reverse()) as unknown as typeof initialManifest
    expect(canonicalManifest(reordered)).toBe(canonicalManifest(initialManifest))
    expect(manifestHash(reordered)).toBe(manifestHash(initialManifest))
  })
})
