import { SOMNIA_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import type { Hex } from 'viem'

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}

export const SHANNON_CHAIN_ID = 50_312
export const SHANNON_RPC_URL = viteEnv.VITE_SOMNIA_RPC_URL ?? 'https://api.infra.testnet.somnia.network'
export const SHANNON_FALLBACK_RPC_URL = viteEnv.VITE_SOMNIA_FALLBACK_RPC_URL ?? 'https://dream-rpc.somnia.network'
export const SHANNON_WS_RPC_URL = viteEnv.VITE_SOMNIA_WS_RPC_URL ?? 'wss://api.infra.testnet.somnia.network/ws'
export const DREAMDEX_INDEXER_URL = viteEnv.VITE_DREAMDEX_INDEXER_URL ?? 'https://dev.smk.somnia.host/v1/graphql'
export const SHANNON_EXPLORER_URL = 'https://shannon-explorer.somnia.network'

export const DREAMDEX_CONTRACTS = {
  ...SOMNIA_TESTNET_ADDRESSES,
  operatorPermissionsRegistry: '0x15C7e8CE38F021c5b45d098AaD788f63090bF20A',
  spotPoolRegistry: '0x07A29A0A086Bc8262a9320db93E603eE13D57962',
} as const

export const PLACE_ORDER_FOR_SELECTOR = '0x80054449' as const

export function createDreamDexExchange(privateKey?: Hex) {
  return new SomniaMarkets({
    indexerUrl: DREAMDEX_INDEXER_URL,
    chain: somniaShannon,
    wsRpcUrl: SHANNON_WS_RPC_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey,
  })
}
