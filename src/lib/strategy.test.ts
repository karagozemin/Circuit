import { describe, expect, it } from 'vitest'
import { compileIntent, initialManifest, validateManifest } from './strategy'

describe('strategy manifest validation', () => {
  it('accepts the P0 contrarian roller', () => {
    expect(validateManifest(initialManifest)).toEqual([])
  })
  it('requires a hard cap and finite rounds', () => {
    const issues = validateManifest({ ...initialManifest, policy: { ...initialManifest.policy, maxTotalCapitalAtRisk: '0', maxRounds: 0 } })
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['policy.maxTotalCapitalAtRisk', 'policy.maxRounds']))
  })
})

describe('agent compiler', () => {
  it('extracts the locked demo intent', () => {
    const draft = compileIntent('If BTC 15m UP trades above 70%, buy DOWN with 10. Roll half after a win and stop after two losses. Never risk more than 20.')
    expect(draft.series).toEqual({ asset: 'BTC', intervalSec: 900 })
    expect(draft.trigger?.value).toBe('0.7')
    expect(draft.action?.type).toBe('BUY_DOWN')
  })
})


describe('untrusted intent drafts', () => {
  it('leaves every omitted safety bound absent', () => {
    const draft = compileIntent('BTC 15m above 70%, buy DOWN')
    expect(draft.action?.maxCollateral).toBeUndefined()
    expect(draft.action?.maxSlippageBps).toBeUndefined()
    expect(draft.policy).toEqual({})
    expect(validateManifest(draft).map(i => i.path)).toContain('policy.maxTotalCapitalAtRisk')
  })
  it('accepts a fully explicit English intent', () => {
    const draft = compileIntent('BTC 15m above 70%, buy DOWN with 10. Roll half, stop after two losses. Never risk more than 20. Max 5 rounds, slippage 200 bps, expiry buffer 120 seconds.')
    expect(validateManifest(draft)).toEqual([])
  })
  it('rejects malformed output, NaN, empty strings and unsupported actions without crashing', () => {
    for (const value of [null, [], 'invalid', {}, { ...initialManifest, action: { ...initialManifest.action, type: 'SELL', maxSlippageBps: NaN } }]) {
      expect(validateManifest(value).length).toBeGreaterThan(0)
    }
    expect(validateManifest({...initialManifest, policy: {...initialManifest.policy, maxTotalCapitalAtRisk:''}}).map(i => i.path)).toContain('policy.maxTotalCapitalAtRisk')
  })
})
