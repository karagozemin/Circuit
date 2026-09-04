import { discoverTradingMarket } from '../src/lib/dreamdex/discovery'
import { DREAMDEX_CONTRACTS, DREAMDEX_INDEXER_URL, SHANNON_CHAIN_ID, SHANNON_EXPLORER_URL, SHANNON_RPC_URL } from '../src/lib/dreamdex/config'

function stringify(value: unknown) {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)
}

try {
  const market = await discoverTradingMarket()
  console.log(stringify({
    ok: true,
    network: { name: 'Somnia Shannon Testnet', chainId: SHANNON_CHAIN_ID, rpc: SHANNON_RPC_URL },
    indexer: DREAMDEX_INDEXER_URL,
    contracts: {
      binaryModule: DREAMDEX_CONTRACTS.binaryModule,
      binarySettlement: DREAMDEX_CONTRACTS.binarySettlement,
      operatorPermissionsRegistry: DREAMDEX_CONTRACTS.operatorPermissionsRegistry,
      collateral: DREAMDEX_CONTRACTS.collateral,
    },
    market,
    explorer: `${SHANNON_EXPLORER_URL}/address/${market.marketAddress}`,
  }))
  process.exit(0)
} catch (error) {
  console.error(stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
}
