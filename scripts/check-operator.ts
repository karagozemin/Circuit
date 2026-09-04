import { binaryPoolWriteAbi, decodeRevert } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, fallback, http, isAddress, type Address } from 'viem'
import {
  BINARY_PLACE_ORDER_FOR_SELECTOR,
  createDreamDexExchange,
  SHANNON_FALLBACK_RPC_URL,
  SHANNON_RPC_URL,
} from '../src/lib/dreamdex/config'

function argument(name: string) {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
}

const owner = (argument('owner') ?? process.env.CIRCUIT_OWNER_ADDRESS) as Address | undefined
const operator = (argument('operator') ?? process.env.CIRCUIT_ENGINE_ADDRESS) as Address | undefined
if (!owner || !isAddress(owner)) throw new Error('Pass --owner=0x... or set CIRCUIT_OWNER_ADDRESS.')
if (!operator || !isAddress(operator)) throw new Error('Pass --operator=0x... or set CIRCUIT_ENGINE_ADDRESS.')

const exchange = createDreamDexExchange()
const candidates = await exchange.client.listBinaryMarkets({ orderBy: 'newest', limit: 20 })
const market = candidates.find((candidate) => candidate.status === 'Trading') ?? candidates[0]
if (!market) throw new Error('No binary Event Contract market is available for the authorization probe.')

const diagnosticRpc = process.env.CIRCUIT_DIAGNOSTIC_RPC_URL ?? 'https://rpc.ankr.com/somnia_testnet'
const publicClient = createPublicClient({
  chain: somniaShannon,
  transport: fallback([http(SHANNON_RPC_URL), http(SHANNON_FALLBACK_RPC_URL), http(diagnosticRpc)]),
})

let errorName: string | null = null
try {
  await publicClient.simulateContract({
    account: operator,
    address: market.poolAddress,
    abi: binaryPoolWriteAbi,
    functionName: 'placeBinaryOrderFor',
    args: [
      owner,
      2,
      500_000n,
      1_000_000n,
      BigInt(market.expiry) * 1_000_000_000n,
      2,
      0,
      '0x0000000000000000000000000000000000000000',
      0n,
      0n,
    ],
  })
} catch (error) {
  errorName = decodeRevert(error, {
    address: market.poolAddress,
    functionName: 'placeBinaryOrderFor',
  }).errorName ?? 'UnknownRevert'
}

const authorized = errorName !== 'OnlyApprovedContracts'

console.log(JSON.stringify({
  owner,
  operator,
  marketId: market.marketId,
  pool: market.poolAddress,
  selector: BINARY_PLACE_ORDER_FOR_SELECTOR,
  authorizationModel: 'dreamDEX protocol system-contract allowlist',
  simulatedRevert: errorName,
  authorizedForCurrentPool: authorized,
  note: authorized
    ? 'The system-contract gate passed; any reported revert occurred later in order validation.'
    : 'Binary Event Contracts do not use the user-managed SpotPool operator registry.',
}, null, 2))
process.exit(authorized ? 0 : 2)
