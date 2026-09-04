import { isAddress, type Address } from 'viem'
import { PLACE_ORDER_FOR_SELECTOR, createDreamDexExchange } from '../src/lib/dreamdex/config'
import { discoverTradingMarket } from '../src/lib/dreamdex/discovery'

function argument(name: string) {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
}

const owner = (argument('owner') ?? process.env.CIRCUIT_OWNER_ADDRESS) as Address | undefined
const operator = (argument('operator') ?? process.env.CIRCUIT_ENGINE_ADDRESS) as Address | undefined
if (!owner || !isAddress(owner)) throw new Error('Pass --owner=0x... or set CIRCUIT_OWNER_ADDRESS.')
if (!operator || !isAddress(operator)) throw new Error('Pass --operator=0x... or set CIRCUIT_ENGINE_ADDRESS.')

const exchange = createDreamDexExchange()
const market = await discoverTradingMarket({ exchange })
const [registry, globalGrant, authorized] = await Promise.all([
  exchange.client.getOperatorPermissionsRegistry(market.pool),
  exchange.client.isGloballyApproved({ owner, operator, selector: PLACE_ORDER_FOR_SELECTOR }),
  exchange.client.isOperatorAuthorized({ pool: market.pool, owner, operator, selector: PLACE_ORDER_FOR_SELECTOR }),
])

console.log(JSON.stringify({
  owner,
  operator,
  marketId: market.marketId,
  pool: market.pool,
  selector: PLACE_ORDER_FOR_SELECTOR,
  registry,
  globalGrant,
  authorizedForCurrentPool: authorized,
}, null, 2))
process.exit(authorized ? 0 : 2)

