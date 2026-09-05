import type { PlaceOrderResult } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createWalletClient, custom, type Address, type Hash } from 'viem'
import type { StrategyManifest } from '../strategy'
import type { InjectedProvider } from '../wallet'
import { createDreamDexExchange } from './config'
import { isMarketEligible, type TradingMarketSnapshot } from './discovery'

export interface SdkOrderPlan {
  symbol: string
  side: 'BUY_YES' | 'BUY_NO'
  bestAsk: number
  limitPrice: number
  quantity: number
  maxSpend: number
  maxCollateral: number
  maxSlippageBps: number
}

export interface SdkOrderResult extends SdkOrderPlan {
  hash: Hash
  blockNumber: bigint
  orderId?: bigint
  orderStatus: string
  filled: number
  remaining: number
}

/**
 * Build a bounded IOC quote from the current opposite book side. The SDK does
 * the final tick/lot alignment before the transaction is encoded.
 */
export function buildSdkOrderPlan(
  manifest: StrategyManifest,
  market: Pick<TradingMarketSnapshot, 'yesSymbol' | 'noSymbol' | 'collateralDecimals'>,
  bestAsk: number,
): SdkOrderPlan {
  if (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1) {
    throw new Error('The selected outcome has no usable ask price.')
  }
  if (market.collateralDecimals !== 6) {
    throw new Error('Circuit P0 supports only 6-decimal dreamDEX collateral.')
  }

  const maxCollateral = Number(manifest.action.maxCollateral)
  const maxSlippageBps = manifest.action.maxSlippageBps
  if (!Number.isFinite(maxCollateral) || maxCollateral <= 0) {
    throw new Error('Max order collateral must be greater than zero.')
  }
  if (maxCollateral > 10) {
    throw new Error('Circuit P0 order cap is 10 collateral.')
  }
  if (!Number.isInteger(maxSlippageBps) || maxSlippageBps < 0 || maxSlippageBps > 1_000) {
    throw new Error('Slippage must be an integer between 0 and 1000 bps.')
  }

  const side = manifest.action.type === 'BUY_UP' ? 'BUY_YES' : 'BUY_NO'
  const symbol = manifest.action.type === 'BUY_UP' ? market.yesSymbol : market.noSymbol
  const limitPrice = Math.min(0.999, bestAsk * (10_000 + maxSlippageBps) / 10_000)
  const quantity = Math.floor((maxCollateral / limitPrice) * 1_000) / 1_000
  const maxSpend = quantity * limitPrice

  if (!Number.isFinite(quantity) || quantity <= 0 || maxSpend > maxCollateral + Number.EPSILON) {
    throw new Error('Unable to construct an order inside the collateral cap.')
  }

  return { symbol, side, bestAsk, limitPrice, quantity, maxSpend, maxCollateral, maxSlippageBps }
}

/**
 * Place one user-approved IOC through dreamDEX's browser-compatible market SDK.
 * This intentionally uses `placeBinaryOrder` via `exchange.createOrder`; it
 * never calls the Engine's delegated `placeOrderFor` entry point.
 */
export async function placeSdkOrder(
  provider: InjectedProvider,
  account: Address,
  manifest: StrategyManifest,
  market: TradingMarketSnapshot,
): Promise<SdkOrderResult> {
  const walletClient = createWalletClient({
    account,
    chain: somniaShannon,
    transport: custom(provider),
  })
  const exchange = createDreamDexExchange()
  exchange.setSigner({ walletClient })
  await exchange.loadMarkets(true)

  const latest = await exchange.client.getMarketOnchain(market.marketId)
  const nowSec = Math.floor(Date.now() / 1_000)
  if (!isMarketEligible(latest, nowSec, manifest.policy.minSecondsToExpiry)) {
    throw new Error('Market is no longer Trading or crossed the configured expiry buffer. Order aborted.')
  }

  const symbol = manifest.action.type === 'BUY_UP' ? market.yesSymbol : market.noSymbol
  const book = await exchange.fetchOrderBook(symbol, 5)
  const bestAsk = book.asks[0]?.[0]
  if (bestAsk === undefined) throw new Error(`No resting ${manifest.action.type === 'BUY_UP' ? 'UP' : 'DOWN'} liquidity. Nothing was submitted.`)

  const plan = buildSdkOrderPlan(manifest, market, bestAsk)
  const order = await exchange.createOrder(plan.symbol, 'limit', 'buy', plan.quantity, plan.limitPrice, { timeInForce: 'IOC' })
  const result = order.info as PlaceOrderResult
  return {
    ...plan,
    hash: result.hash,
    blockNumber: result.receipt.blockNumber,
    orderId: result.orderId,
    orderStatus: order.status,
    filled: order.filled,
    remaining: order.remaining,
  }
}
