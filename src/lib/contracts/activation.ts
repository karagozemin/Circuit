import { SDK, SomniaReactivityPrecompileABI } from '@somnia-chain/reactivity'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  fallback,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  parseGwei,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import type { StrategyManifest } from '../strategy'
import type { InjectedProvider, WalletSnapshot } from '../wallet'
import {
  SHANNON_DIAGNOSTIC_RPC_URL,
  SHANNON_FALLBACK_RPC_URL,
  SHANNON_RPC_URL,
} from '../dreamdex/config'
import type { TradingMarketSnapshot } from '../dreamdex/discovery'
import { circuitEngineAbi, manifestHash, manifestToEngineConfig } from './engine'

export const REACTIVITY_MIN_BALANCE = 32n * 10n ** 18n
export const ORDER_FILLED_TOPIC = '0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399' as Hex

export interface CircuitDeployment {
  engine: Address
  handler: Address
}

export type ReadinessCheck = {
  id: 'deployment' | 'wiring' | 'market' | 'balance' | 'sdk'
  label: string
  state: 'pass' | 'fail' | 'checking'
  detail: string
}

export interface ActivationPreflight {
  ready: boolean
  deployment?: CircuitDeployment
  checks: ReadinessCheck[]
}

export interface TransactionResult {
  hash: Hash
  blockNumber: bigint
}

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
const binaryMarketReadAbi = [
  { type: 'function', name: 'status', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'expiry', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint64' }] },
] as const

export function parseDeployment(engineValue?: string, handlerValue?: string): CircuitDeployment | undefined {
  if (!engineValue || !handlerValue || !isAddress(engineValue) || !isAddress(handlerValue)) return undefined
  return { engine: getAddress(engineValue), handler: getAddress(handlerValue) }
}

export function configuredDeployment() {
  return parseDeployment(viteEnv.VITE_CIRCUIT_ENGINE_ADDRESS, viteEnv.VITE_CIRCUIT_HANDLER_ADDRESS)
}

function publicClient() {
  return createPublicClient({
    chain: somniaShannon,
    transport: fallback([
      http(SHANNON_RPC_URL),
      http(SHANNON_FALLBACK_RPC_URL),
      http(SHANNON_DIAGNOSTIC_RPC_URL),
    ]),
  })
}

function clients(provider: InjectedProvider, account: Address) {
  return {
    public: publicClient(),
    wallet: createWalletClient({ account, chain: somniaShannon, transport: custom(provider) }),
  }
}

async function successfulReceipt(hash: Hash) {
  const receipt = await publicClient().waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`)
  return receipt
}

export async function inspectActivation(
  wallet: WalletSnapshot,
  market: TradingMarketSnapshot,
  minSecondsToExpiry = 120,
  requiresSubscriptionBalance = true,
): Promise<ActivationPreflight> {
  const deployment = configuredDeployment()
  if (!deployment) {
    return {
      ready: false,
      checks: [{
        id: 'deployment',
        label: 'Circuit contracts',
        state: 'fail',
        detail: 'Set VITE_CIRCUIT_ENGINE_ADDRESS and VITE_CIRCUIT_HANDLER_ADDRESS after deployment.',
      }],
    }
  }

  const client = publicClient()
  const checks: ReadinessCheck[] = []
  const [engineCode, handlerCode] = await Promise.all([
    client.getCode({ address: deployment.engine }),
    client.getCode({ address: deployment.handler }),
  ])
  const deployed = Boolean(engineCode && engineCode !== '0x' && handlerCode && handlerCode !== '0x')
  checks.push({
    id: 'deployment',
    label: 'Circuit contracts',
    state: deployed ? 'pass' : 'fail',
    detail: deployed ? 'Engine and handler bytecode verified on Shannon.' : 'Configured Engine or handler has no Shannon bytecode.',
  })
  if (!deployed) return { ready: false, deployment, checks }

  const wiredHandler = await client.readContract({
    address: deployment.engine,
    abi: circuitEngineAbi,
    functionName: 'reactivityHandler',
  })
  const wired = wiredHandler.toLowerCase() === deployment.handler.toLowerCase()
  checks.push({
    id: 'wiring',
    label: 'Engine-handler wiring',
    state: wired ? 'pass' : 'fail',
    detail: wired ? 'Engine points to the configured handler.' : `Engine points to ${wiredHandler}.`,
  })

  const [onchainStatus, onchainExpiry, block] = await Promise.all([
    client.readContract({ address: market.marketAddress, abi: binaryMarketReadAbi, functionName: 'status' }),
    client.readContract({ address: market.marketAddress, abi: binaryMarketReadAbi, functionName: 'expiry' }),
    client.getBlock(),
  ])
  const secondsToExpiry = Number(onchainExpiry - block.timestamp)
  const marketReady = onchainStatus === 1
    && secondsToExpiry >= minSecondsToExpiry
    && market.collateralDecimals === 6
  checks.push({
    id: 'market',
    label: 'Market chain truth',
    state: marketReady ? 'pass' : 'fail',
    detail: marketReady
      ? `${market.asset} market is Trading with ${secondsToExpiry}s remaining at block ${block.number}.`
      : `Market is locked, inside the ${minSecondsToExpiry}s expiry buffer, or uses unsupported collateral decimals.`,
  })

  const funded = !requiresSubscriptionBalance || wallet.balance >= REACTIVITY_MIN_BALANCE
  checks.push({
    id: 'balance',
    label: 'Reactivity balance',
    state: funded ? 'pass' : 'fail',
    detail: !requiresSubscriptionBalance
      ? 'Reactivity subscription is already confirmed for this activation.'
      : funded ? 'Wallet meets the 32 STT subscription minimum.' : 'Wallet needs at least 32 STT for Reactivity.',
  })

  checks.push({
    id: 'sdk',
    label: 'Market SDK order path',
    state: 'pass',
    detail: 'Direct wallet signer will call BinaryPool.placeBinaryOrder through @somnia-chain/markets-sdk. Engine allowlisting is not required for this path.',
  })

  return { ready: checks.every((check) => check.state === 'pass'), deployment, checks }
}

export async function createStrategyTransaction(
  provider: InjectedProvider,
  account: Address,
  deployment: CircuitDeployment,
  manifest: StrategyManifest,
) {
  const { wallet } = clients(provider, account)
  const hash = await wallet.writeContract({
    address: deployment.engine,
    abi: circuitEngineAbi,
    functionName: 'createStrategy',
    args: [manifestHash(manifest), manifestToEngineConfig(manifest)],
  })
  const receipt = await successfulReceipt(hash)
  const created = parseEventLogs({ abi: circuitEngineAbi, eventName: 'StrategyCreated', logs: receipt.logs })[0]
  if (!created) throw new Error('StrategyCreated event was not found in the receipt.')
  return { hash, blockNumber: receipt.blockNumber, strategyId: created.args.strategyId }
}

export async function bindMarketTransaction(
  provider: InjectedProvider,
  account: Address,
  deployment: CircuitDeployment,
  manifest: StrategyManifest,
  market: TradingMarketSnapshot,
  strategyId: Hex,
): Promise<TransactionResult> {
  const { wallet } = clients(provider, account)
  const outcomeTokenId = manifest.action.type === 'BUY_UP' ? market.yesId : market.noId
  const hash = await wallet.writeContract({
    address: deployment.engine,
    abi: circuitEngineAbi,
    functionName: 'bindMarket',
    args: [strategyId, market.marketId, market.marketAddress, market.pool, market.collateral, market.outcomeToken, outcomeTokenId],
  })
  const receipt = await successfulReceipt(hash)
  return { hash, blockNumber: receipt.blockNumber }
}

export async function createSubscriptionTransaction(
  provider: InjectedProvider,
  account: Address,
  deployment: CircuitDeployment,
  market: TradingMarketSnapshot,
) {
  const client = clients(provider, account)
  const sdk = new SDK({ public: client.public, wallet: client.wallet })
  const hash = await sdk.subscribe({
    handlerContractAddress: deployment.handler,
    filter: { eventTopics: [ORDER_FILLED_TOPIC], emitter: market.pool },
    options: { priorityFeePerGas: parseGwei('2'), maxFeePerGas: parseGwei('20'), gasLimit: 2_000_000n },
  })
  if (hash instanceof Error) throw hash
  const receipt = await successfulReceipt(hash)
  let subscriptionId: bigint | undefined
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: SomniaReactivityPrecompileABI, data: log.data, topics: log.topics })
      if (decoded.eventName === 'SubscriptionCreated') subscriptionId = decoded.args.subscriptionId
    } catch {
      // The receipt also includes non-precompile logs.
    }
  }
  if (subscriptionId === undefined) throw new Error('SubscriptionCreated event was not found in the receipt.')
  return { hash, blockNumber: receipt.blockNumber, subscriptionId }
}

export async function strategyTransaction(
  provider: InjectedProvider,
  account: Address,
  deployment: CircuitDeployment,
  action: 'activateStrategy' | 'pauseStrategy' | 'resumeStrategy' | 'cancelStrategy',
  strategyId: Hex,
): Promise<TransactionResult> {
  const { wallet } = clients(provider, account)
  const hash = await wallet.writeContract({
    address: deployment.engine,
    abi: circuitEngineAbi,
    functionName: action,
    args: [strategyId],
  })
  const receipt = await successfulReceipt(hash)
  return { hash, blockNumber: receipt.blockNumber }
}
