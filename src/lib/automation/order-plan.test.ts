import { describe, expect, it } from 'vitest'
import { planReadyOrder, type OrderBounds } from './order-plan'
const bounds: OrderBounds = { actionType: 1, triggerFillPrice: 750000n, maxSlippageBps: 200, maxOrderCollateral: 10000000n, nextOrderBudget: 5000000n, maxTotalCapitalAtRisk: 20000000n, cumulativeCapitalUsed: 17500000n }
const grid = { tickSize: 1000n, lotSize: 1000000n, minQuantity: 1000000n }
describe('keeper order bounds', () => {
  it('rounds DOWN buy limits up in YES space and fits remaining capital', () => {
    const order = planReadyOrder(bounds, grid)
    expect(order).toEqual({yesLimitPrice:745000n, quantity:9000000n, maxSpend:2295000n})
  })
  it('rounds UP buy limits down without exceeding slippage', () => {
    const order = planReadyOrder({...bounds, actionType:0, triggerFillPrice:701123n}, grid)
    expect(order.yesLimitPrice).toBe(715000n)
    expect(order.maxSpend <= 2500000n).toBe(true)
  })
  it('refuses dust, depleted capital and impossible endpoint prices', () => {
    expect(() => planReadyOrder({...bounds,nextOrderBudget:1n},grid)).toThrow('minimum lot')
    expect(() => planReadyOrder({...bounds,cumulativeCapitalUsed:20000000n},grid)).toThrow('exhausted')
    expect(() => planReadyOrder({...bounds,triggerFillPrice:1000000n},grid)).toThrow('No executable')
  })
})
