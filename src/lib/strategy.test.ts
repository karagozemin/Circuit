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
    expect(draft.trigger?.value).toBe('0.700')
    expect(draft.action?.type).toBe('BUY_DOWN')
  })
})
