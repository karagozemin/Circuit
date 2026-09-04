import { SDK, SomniaReactivityPrecompileABI } from '@somnia-chain/reactivity'
import { createPublicClient, createWalletClient, decodeEventLog, fallback, http, isAddress, parseGwei, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { SHANNON_FALLBACK_RPC_URL, SHANNON_RPC_URL } from '../src/lib/dreamdex/config'
import { discoverTradingMarket } from '../src/lib/dreamdex/discovery'

const privateKey = process.env.CIRCUIT_OPERATOR_PRIVATE_KEY as Hex | undefined
const handler = process.env.CIRCUIT_HANDLER_ADDRESS as Address | undefined
if (!privateKey) throw new Error('CIRCUIT_OPERATOR_PRIVATE_KEY is required. Keep it server-side and out of git.')
if (!handler || !isAddress(handler)) throw new Error('CIRCUIT_HANDLER_ADDRESS must be a deployed handler address.')

const account = privateKeyToAccount(privateKey)
const rpcTransport = fallback([http(SHANNON_RPC_URL), http(SHANNON_FALLBACK_RPC_URL)])
const publicClient = createPublicClient({ chain: somniaShannon, transport: rpcTransport })
const walletClient = createWalletClient({ account, chain: somniaShannon, transport: rpcTransport })
const balance = await publicClient.getBalance({ address: account.address })
if (balance < 32n * 10n ** 18n) {
  throw new Error(`Subscription owner ${account.address} has less than the required 32 STT balance.`)
}

const market = await discoverTradingMarket()
const sdk = new SDK({ public: publicClient, wallet: walletClient })
const orderFilledTopic = '0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399' as Hex
const transactionHash = await sdk.subscribe({
  handlerContractAddress: handler,
  filter: { eventTopics: [orderFilledTopic], emitter: market.pool },
  options: {
    priorityFeePerGas: parseGwei('2'),
    maxFeePerGas: parseGwei('20'),
    gasLimit: 2_000_000n,
  },
})
if (transactionHash instanceof Error) throw transactionHash

const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
let subscriptionId: bigint | undefined
for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({ abi: SomniaReactivityPrecompileABI, data: log.data, topics: log.topics })
    if (decoded.eventName === 'SubscriptionCreated') subscriptionId = decoded.args.subscriptionId
  } catch {
    // Ignore logs from contracts other than the Reactivity precompile.
  }
}

console.log(JSON.stringify({
  ok: receipt.status === 'success',
  owner: account.address,
  handler,
  marketId: market.marketId,
  emitter: market.pool,
  topic0: orderFilledTopic,
  transactionHash,
  subscriptionId: subscriptionId?.toString() ?? null,
}, null, 2))
process.exit(receipt.status === 'success' ? 0 : 1)
