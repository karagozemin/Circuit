import { describe, expect, it } from 'vitest'
import { initialManifest } from '../strategy'
import { buildSdkOrderPlan } from './trading'

const market = {
  yesSymbol: 'BTC-TEST/USDC#YES',
  noSymbol: 'BTC-TEST/USDC#NO',
  collateralDecimals: 6,
} as const

describe('dreamDEX wallet SDK order plan', () => {
  it('maps BUY_DOWN to the NO outcome and stays below the collateral cap', () => {
    const plan = buildSdkOrderPlan(initialManifest, market, 0.35)
    expect(plan.side).toBe('BUY_NO')
    expect(plan.symbol).toBe(market.noSymbol)
    expect(plan.maxSpend).toBeLessThanOrEqual(Number(initialManifest.action.maxCollateral))
    expect(plan.limitPrice).toBeGreaterThan(0.35)
  })

  it('maps BUY_UP to the YES outcome', () => {
    const plan = buildSdkOrderPlan({ ...initialManifest, action: { ...initialManifest.action, type: 'BUY_UP' } }, market, 0.65)
    expect(plan.side).toBe('BUY_YES')
    expect(plan.symbol).toBe(market.yesSymbol)
  })

  it('rejects empty liquidity and unsupported collateral precision', () => {
    expect(() => buildSdkOrderPlan(initialManifest, market, 0)).toThrow(/ask price/i)
    expect(() => buildSdkOrderPlan(initialManifest, { ...market, collateralDecimals: 18 }, 0.35)).toThrow(/6-decimal/i)
    expect(() => buildSdkOrderPlan({ ...initialManifest, action: { ...initialManifest.action, maxCollateral: '10.001' } }, market, 0.35)).toThrow(/order cap is 10/i)
  })
})
