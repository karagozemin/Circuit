export interface OrderBounds {
  actionType: number
  triggerFillPrice: bigint
  maxSlippageBps: number
  maxOrderCollateral: bigint
  nextOrderBudget: bigint
  maxTotalCapitalAtRisk: bigint
  cumulativeCapitalUsed: bigint
}
export interface OrderGrid { tickSize: bigint; lotSize: bigint; minQuantity: bigint }

/** Largest IOC on the pool grid that fits the approved outcome-price and capital bounds. */
export function planReadyOrder(bounds: OrderBounds, grid: OrderGrid) {
  const scale = 1_000_000n
  if (grid.tickSize <= 0n || grid.lotSize <= 0n || grid.minQuantity <= 0n) throw new Error('Invalid pool grid.')
  if (bounds.actionType !== 0 && bounds.actionType !== 1) throw new Error('Unsupported action.')
  if (bounds.triggerFillPrice < 0n || bounds.triggerFillPrice > scale) throw new Error('Invalid fill price.')
  if (!Number.isInteger(bounds.maxSlippageBps) || bounds.maxSlippageBps < 0 || bounds.maxSlippageBps > 1000) throw new Error('Invalid slippage.')
  const min = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b)
  const observed = bounds.actionType === 0 ? bounds.triggerFillPrice : scale - bounds.triggerFillPrice
  const outcomeCeiling = min(scale - 1n, observed * (10_000n + BigInt(bounds.maxSlippageBps)) / 10_000n)
  const yesLimitPrice = bounds.actionType === 0
    ? outcomeCeiling / grid.tickSize * grid.tickSize
    : ((scale - outcomeCeiling + grid.tickSize - 1n) / grid.tickSize) * grid.tickSize
  if (yesLimitPrice <= 0n || yesLimitPrice >= scale) throw new Error('No executable price within slippage.')
  const outcomePrice = bounds.actionType === 0 ? yesLimitPrice : scale - yesLimitPrice
  const budget = min(bounds.nextOrderBudget, bounds.maxOrderCollateral, bounds.maxTotalCapitalAtRisk - bounds.cumulativeCapitalUsed)
  if (budget <= 0n) throw new Error('Capital cap exhausted.')
  const quantity = (budget * scale / outcomePrice) / grid.lotSize * grid.lotSize
  if (quantity < grid.minQuantity || quantity === 0n) throw new Error('Budget below minimum lot.')
  return { yesLimitPrice, quantity, maxSpend: (quantity * outcomePrice + scale - 1n) / scale }
}
