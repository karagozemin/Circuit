import { describe, expect, it } from 'vitest'
import { changeMarketWindow, compileIntent, initialManifest, validateManifest } from './strategy'

describe('one-minute windows', () => {
  it.each(['5m', '5 min', '5 minutes', '5 dakika'])('extracts %s as a five-minute window', window => {
    expect(compileIntent(`BTC ${window} above 70%, buy DOWN`).series?.intervalSec).toBe(300)
  })
  it('replaces an incompatible buffer and keeps compatible custom limits', () => {
    const minute = changeMarketWindow(initialManifest, 60)
    expect(minute.series.intervalSec).toBe(60)
    expect(minute.policy.minSecondsToExpiry).toBe(10)
    expect(validateManifest(minute)).toEqual([])
    expect(initialManifest.policy.minSecondsToExpiry).toBe(120)
    const custom = { ...initialManifest, policy: { ...initialManifest.policy, minSecondsToExpiry: 25 } }
    expect(changeMarketWindow(custom, 60).policy.minSecondsToExpiry).toBe(25)
  })
  it.each([60, 120])('rejects a %ss buffer that cannot fit a one-minute window', buffer => {
    const minute = changeMarketWindow(initialManifest, 60)
    minute.policy.minSecondsToExpiry = buffer
    expect(validateManifest(minute).map(issue => issue.path)).toContain('policy.minSecondsToExpiry')
  })
  it.each(['1m', '1 min', '1 minute', '1 dakika', '1dk'])('extracts %s without inventing a buffer', window => {
    const draft = compileIntent(`BTC ${window} above 70%, buy DOWN`)
    expect(draft.series).toEqual({ asset: 'BTC', intervalSec: 60 })
    expect(draft.policy?.minSecondsToExpiry).toBeUndefined()
  })
})

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
