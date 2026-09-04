import type { Hex, TransactionReceipt } from 'viem'
import type { PlaceOrderResult } from '@somnia-chain/markets-sdk'
import { createDreamDexExchange } from '../src/lib/dreamdex/config'
import { discoverTradingMarket, isMarketEligible } from '../src/lib/dreamdex/discovery'

const execute = process.argv.includes('--execute')
const requestedSide = process.argv.find((argument) => argument.startsWith('--side='))?.split('=')[1]?.toUpperCase()
const side = requestedSide === 'UP' ? 'UP' : 'DOWN'
const maxCollateral = Number(process.env.CIRCUIT_MAX_COLLATERAL ?? '1')
const maxSlippageBps = Number(process.env.CIRCUIT_MAX_SLIPPAGE_BPS ?? '200')
const privateKey = process.env.CIRCUIT_OPERATOR_PRIVATE_KEY as Hex | undefined

if (!Number.isFinite(maxCollateral) || maxCollateral <= 0 || maxCollateral > 10) {
  throw new Error('CIRCUIT_MAX_COLLATERAL must be greater than 0 and no more than the P0 cap of 10.')
}
if (!Number.isInteger(maxSlippageBps) || maxSlippageBps < 0 || maxSlippageBps > 1_000) {
  throw new Error('CIRCUIT_MAX_SLIPPAGE_BPS must be an integer between 0 and 1000.')
}
if (execute && !privateKey) {
  throw new Error('Set CIRCUIT_OPERATOR_PRIVATE_KEY in the shell before using --execute. Never use a VITE_* variable for a private key.')
}

const exchange = createDreamDexExchange(privateKey)
const market = await discoverTradingMarket({ exchange, minSecondsToExpiry: 120 })
const symbol = side === 'UP' ? market.yesSymbol : market.noSymbol
const book = await exchange.fetchOrderBook(symbol, 5)
const bestAsk = book.asks[0]?.[0]

if (bestAsk === undefined) throw new Error(`No resting ${side} liquidity. Nothing will be submitted.`)

const priceScale = 1_000
const limitPrice = Math.min(0.999, Math.ceil(bestAsk * (10_000 + maxSlippageBps) / 10_000 * priceScale) / priceScale)
const quantity = Math.floor(maxCollateral / limitPrice * priceScale) / priceScale
const maxSpend = quantity * limitPrice

if (quantity <= 0 || maxSpend > maxCollateral + Number.EPSILON) {
  throw new Error('Unable to construct an order inside the collateral cap.')
}

const plan = {
  mode: execute ? 'EXECUTE' : 'DRY_RUN',
  marketId: market.marketId,
  pool: market.pool,
  symbol,
  side: `BUY_${side}`,
  timeInForce: 'IOC',
  bestAsk,
  limitPrice,
  quantity,
  maxSpend,
  maxCollateral,
  maxSlippageBps,
  secondsToExpiry: market.secondsToExpiry,
}
console.log(JSON.stringify(plan, null, 2))

if (!execute) {
  console.log('\nDry run only. Add --execute with a funded CIRCUIT_OPERATOR_PRIVATE_KEY to broadcast.')
  process.exit(0)
}

// Re-read chain truth immediately before the only write in this script.
const latest = await exchange.client.getMarketOnchain(market.marketId)
if (!isMarketEligible(latest, Math.floor(Date.now() / 1_000), 120)) {
  throw new Error('Market is no longer Trading or crossed the 120s expiry buffer. Order aborted.')
}

const order = await exchange.createOrder(symbol, 'limit', 'buy', quantity, limitPrice, { timeInForce: 'IOC' })
const result = order.info as PlaceOrderResult
const receipt = result.receipt as TransactionReceipt

console.log(JSON.stringify({
  ok: receipt.status === 'success',
  transactionHash: receipt.transactionHash,
  blockNumber: receipt.blockNumber.toString(),
  receiptStatus: receipt.status,
  orderId: order.id,
  orderStatus: order.status,
  filled: order.filled,
  remaining: order.remaining,
}, null, 2))
process.exit(receipt.status === 'success' ? 0 : 1)
