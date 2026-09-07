import type { BinaryMarket, MarketOnchain, SomniaMarkets } from '@somnia-chain/markets-sdk'
import { createPublicClient, fallback, http } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createDreamDexExchange, SHANNON_DIAGNOSTIC_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_RPC_URL } from './config'
import { MarketDiscoveryError } from './discovery-error'
import { defaultExpiryBuffer, type MarketInterval } from '../market-windows'

export interface TradingMarketSnapshot {
  sdkReady?: boolean
  marketId: `0x${string}`
  marketAddress: `0x${string}`
  pool: `0x${string}`
  asset: string
  intervalSec: number
  question: string
  expiry: number
  secondsToExpiry: number
  collateral: `0x${string}`
  collateralDecimals: number
  outcomeToken: `0x${string}`
  yesId: bigint
  noId: bigint
  yesSymbol: string
  noSymbol: string
  bestYesBid: number | null
  bestYesAsk: number | null
  indexedStatus: string
  onchainStatus: number
  blockNumber: bigint
  blockTimestamp: number
}

export interface DiscoverMarketOptions {
  asset?: 'BTC' | 'ETH'
  intervalSec?: MarketInterval
  minSecondsToExpiry?: number
  afterExpiry?: number
  exchange?: SomniaMarkets
}

export function isMarketEligible(
  market: Pick<MarketOnchain, 'status' | 'expiry'>,
  nowSec: number,
  minSecondsToExpiry: number,
) {
  return market.status === 1 && Number(market.expiry) - nowSec >= minSecondsToExpiry
}

async function discoverViaSdk({
  asset = 'BTC',
  intervalSec = 900,
  minSecondsToExpiry = defaultExpiryBuffer(intervalSec),
  afterExpiry = 0,
  exchange = createDreamDexExchange(),
}: DiscoverMarketOptions = {}): Promise<TradingMarketSnapshot> {
  const publicClient = createPublicClient({
    chain: somniaShannon,
    transport: fallback([http(SHANNON_RPC_URL), http(SHANNON_FALLBACK_RPC_URL), http(SHANNON_DIAGNOSTIC_RPC_URL)]),
  })
  const [block, indexedCandidates, unifiedMarkets] = await Promise.all([
    publicClient.getBlock(),
    exchange.client.listLiveBinaryMarkets({ asset, intervalSec, orderBy: 'closingSoon', limit: 20 }),
    exchange.loadMarkets(true),
  ])
  const nowSec = Number(block.timestamp)

  for (const indexed of indexedCandidates) {
    const onchain = await exchange.client.getMarketOnchain(indexed.marketId)
    if (!isMarketEligible(onchain, nowSec, minSecondsToExpiry) || Number(onchain.expiry) <= afterExpiry) continue

    const unified = Object.values(unifiedMarkets).find((market) => {
      const info = market.info as BinaryMarket | undefined
      return info?.marketId === indexed.marketId
    })
    const yesSymbol = unified?.outcomes?.find((outcome) => outcome.index === 0)?.symbol
    const noSymbol = unified?.outcomes?.find((outcome) => outcome.index === 1)?.symbol
    if (!yesSymbol || !noSymbol) continue

    const book = await exchange.fetchOrderBook(yesSymbol, 5)
    return {
      marketId: indexed.marketId,
      marketAddress: onchain.marketAddress,
      pool: onchain.pool,
      asset: indexed.asset,
      intervalSec: Number(indexed.intervalSec),
      question: indexed.question,
      expiry: Number(onchain.expiry),
      secondsToExpiry: Number(onchain.expiry) - nowSec,
      collateral: onchain.collateral,
      collateralDecimals: onchain.decimals,
      outcomeToken: onchain.outcomeToken,
      yesId: onchain.yesId,
      noId: onchain.noId,
      yesSymbol,
      noSymbol,
      bestYesBid: book.bids[0]?.[0] ?? null,
      bestYesAsk: book.asks[0]?.[0] ?? null,
      indexedStatus: indexed.status,
      onchainStatus: onchain.status,
      blockNumber: block.number,
      blockTimestamp: nowSec,
    }
  }

  throw new Error(`No on-chain Trading ${asset} ${intervalSec / 60}m market satisfies the ${minSecondsToExpiry}s expiry buffer.`)
}


export async function discoverTradingMarket(options: DiscoverMarketOptions = {}): Promise<TradingMarketSnapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      discoverViaSdk(options),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('SDK discovery deadline exceeded.')), 8000) }),
    ])
  } catch (sdkError) {
    try {
      const { discoverFromChain } = await import('./chain-discovery')
      return await discoverFromChain(options)
    } catch (chainError) {
      if (chainError instanceof MarketDiscoveryError) throw chainError
      const message = (error: unknown) => error instanceof Error ? error.message : String(error)
      throw new MarketDiscoveryError('connection', `Market verification could not complete. Indexer/SDK: ${message(sdkError)} Chain: ${message(chainError)}`)
    }
  } finally { if (timer) clearTimeout(timer) }
}
