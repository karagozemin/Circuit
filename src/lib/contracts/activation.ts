import { SDK, SomniaReactivityPrecompileABI } from '@somnia-chain/reactivity'
import { binaryModuleReadAbi } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  parseGwei,
  keccak256,
  stringToHex,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import type { StrategyManifest } from '../strategy'
import type { InjectedProvider, WalletSnapshot } from '../wallet'
import {
  DREAMDEX_CONTRACTS,
  SHANNON_DIAGNOSTIC_RPC_URL,
  SHANNON_FALLBACK_RPC_URL,
  SHANNON_RPC_URL,
} from '../dreamdex/config'
import type { TradingMarketSnapshot } from '../dreamdex/discovery'
import { circuitEngineAbi, manifestHash, manifestToEngineConfig } from './engine'

export type TransactionUpdate = { phase:'signature'|'submitted'|'confirmed'; hash?:Hash }
const transactionObservers=new Set<(update:TransactionUpdate)=>void>()
export function observeTransactions(listener:(update:TransactionUpdate)=>void){
  transactionObservers.add(listener)
  return ()=>{transactionObservers.delete(listener)}
}
function transactionUpdate(update:TransactionUpdate){
  for(const observer of transactionObservers){try{observer(update)}catch{/* UI observers cannot interrupt a transaction. */}}
}

export const REACTIVITY_MIN_BALANCE = 32n * 10n ** 18n
export const ORDER_FILLED_TOPIC = '0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399' as Hex

export interface CircuitDeployment {
  engine: Address
  handler: Address
}

export const circuitSmartAccountAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'executor', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const

const collateralWriteAbi = [
  { type: 'function', name: 'faucet', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const
const circuitSmartAccountWriteAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'result', type: 'bytes' }],
  },
] as const

export type ReadinessCheck = {
  id: 'deployment' | 'wiring' | 'market' | 'balance' | 'sdk' | 'smart-account'
  label: string
  state: 'pass' | 'fail' | 'checking'
  detail: string
}

export interface ActivationPreflight {
  ready: boolean
  canPrepareAccount?: boolean
  supportsCombinedSetup?: boolean
  deployment?: CircuitDeployment
  smartAccount?: Address
  checks: ReadinessCheck[]
}

export interface TransactionResult {
  hash: Hash
  blockNumber: bigint
}

export interface SmartAccountPreparationResult {
  requiredCollateral: bigint
  faucet?: TransactionResult
  transfer?: TransactionResult
  approval?: TransactionResult
}

const binaryMarketReadAbi = [
  { type: 'function', name: 'status', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'expiry', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint64' }] },
] as const
const collateralReadAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

export function parseDeployment(engineValue?: string, handlerValue?: string): CircuitDeployment | undefined {
  if (!engineValue || !handlerValue || !isAddress(engineValue) || !isAddress(handlerValue)) return undefined
  return { engine: getAddress(engineValue), handler: getAddress(handlerValue) }
}

export function configuredDeployment() {
  return parseDeployment(import.meta.env?.VITE_CIRCUIT_ENGINE_ADDRESS, import.meta.env?.VITE_CIRCUIT_HANDLER_ADDRESS)
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

function configuredSmartAccount() {
  const value = import.meta.env?.VITE_CIRCUIT_SMART_ACCOUNT_ADDRESS
  return value && isAddress(value) ? getAddress(value) : undefined
}

function clients(provider: InjectedProvider, account: Address) {
  return {
    public: publicClient(),
    wallet: createWalletClient({ account, chain: somniaShannon, transport: custom(provider) }),
  }
}

async function successfulReceipt(hash: Hash) {
  transactionUpdate({phase:'submitted',hash})
  const receipt = await publicClient().waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`)
  transactionUpdate({phase:'confirmed',hash})
  return receipt
}

export async function inspectActivation(
  wallet: WalletSnapshot,
  market: TradingMarketSnapshot,
  manifest: StrategyManifest,
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

  const supportsCombinedSetup = await client.readContract({
    address: deployment.engine, abi: circuitEngineAbi, functionName: 'activationSetupVersion',
  }).then(version => version === 1n).catch(() => false)

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

  const smartAccount = configuredSmartAccount()
  let canPrepareAccount = false
  if (!smartAccount) {
    checks.push({
      id: 'smart-account',
      label: 'User-owned smart account',
      state: 'fail',
      detail: 'Deploy CircuitSmartAccount(owner, engine), fund it, then set VITE_CIRCUIT_SMART_ACCOUNT_ADDRESS.',
    })
  } else {
    const [accountCode, accountOwner, accountExecutor, accountBalance, accountAllowance] = await Promise.all([
      client.getCode({ address: smartAccount }),
      client.readContract({ address: smartAccount, abi: circuitSmartAccountAbi, functionName: 'owner' }),
      client.readContract({ address: smartAccount, abi: circuitSmartAccountAbi, functionName: 'executor' }),
      client.readContract({ address: market.collateral, abi: collateralReadAbi, functionName: 'balanceOf', args: [smartAccount] }),
      client.readContract({ address: market.collateral, abi: collateralReadAbi, functionName: 'allowance', args: [smartAccount, market.pool] }),
    ])
    const requiredCollateral = parseUnits(manifest.action.maxCollateral, market.collateralDecimals)
    const accountConfigured = Boolean(accountCode && accountCode !== '0x')
      && accountOwner.toLowerCase() === wallet.address.toLowerCase()
      && accountExecutor.toLowerCase() === deployment.engine.toLowerCase()
    const accountReady = accountConfigured
      && accountBalance >= requiredCollateral
      && accountAllowance >= requiredCollateral
    canPrepareAccount = accountConfigured && !accountReady && marketReady && wired
    checks.push({
      id: 'smart-account',
      label: 'User-owned smart account',
      state: accountReady ? 'pass' : 'fail',
      detail: accountReady
        ? `${smartAccount.slice(0, 10)}... is owned by the connected wallet, funded, approved for the current pool, and restricted to CircuitEngine.`
        : accountOwner.toLowerCase() !== wallet.address.toLowerCase() || accountExecutor.toLowerCase() !== deployment.engine.toLowerCase()
          ? 'Smart account owner/executor does not match this wallet and Engine deployment.'
          : `Smart account needs at least ${manifest.action.maxCollateral} collateral balance and allowance to the current pool.`,
    })
  }

  checks.push({
    id: 'sdk',
    label: 'Bounded execution path',
    state: 'pass',
    detail: 'Activation links your smart account to CircuitEngine. A running keeper submits orders that the Engine checks against your approved rules.',
  })

  return { ready: checks.every((check) => check.state === 'pass'), deployment, smartAccount, canPrepareAccount, supportsCombinedSetup, checks }
}

export async function createConfiguredStrategyTransaction(
  provider: InjectedProvider,
  account: Address,
  deployment: CircuitDeployment,
  manifest: StrategyManifest,
  executionAccount: Address,
  market: TradingMarketSnapshot,
) {
  const { wallet } = clients(provider, account)
  transactionUpdate({ phase: 'signature' })
  const hash = await wallet.writeContract({
    address: deployment.engine,
    abi: circuitEngineAbi,
    functionName: 'createConfiguredStrategy',
    args: [manifestHash(manifest), manifestToEngineConfig(manifest), executionAccount, market.marketId, true],
  })
  const receipt = await successfulReceipt(hash)
  const created = parseEventLogs({ abi: circuitEngineAbi, eventName: 'StrategyCreated', logs: receipt.logs })[0]
  if (!created) throw new Error('StrategyCreated event was not found in the receipt.')
  return { hash, blockNumber: receipt.blockNumber, strategyId: created.args.strategyId }
}

export async function createStrategyTransaction(
  provider: InjectedProvider,
  account: Address,
  deployment: CircuitDeployment,
  manifest: StrategyManifest,
) {
  const { wallet } = clients(provider, account)
  transactionUpdate({phase:'signature'})
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
  transactionUpdate({phase:'signature'})
  const hash = await wallet.writeContract({
    address: deployment.engine,
    abi: circuitEngineAbi,
    functionName: 'bindMarket',
    args: [strategyId, market.marketId, market.marketAddress, market.pool, market.collateral, market.outcomeToken, outcomeTokenId],
  })
  const receipt = await successfulReceipt(hash)
  return { hash, blockNumber: receipt.blockNumber }
}

export async function setExecutionAccountTransaction(
  provider: InjectedProvider,
  account: Address,
  deployment: CircuitDeployment,
  strategyId: Hex,
  executionAccount: Address,
): Promise<TransactionResult> {
  const { wallet } = clients(provider, account)
  transactionUpdate({phase:'signature'})
  const hash = await wallet.writeContract({
    address: deployment.engine,
    abi: circuitEngineAbi,
    functionName: 'setExecutionAccount',
    args: [strategyId, executionAccount],
  })
  const receipt = await successfulReceipt(hash)
  return { hash, blockNumber: receipt.blockNumber }
}

/**
 * Prepare the user-owned execution account for the currently resolved pool.
 *
 * The connected owner signs every write. The account is funded only for the
 * manifest's max order amount, and approval is sent through the account so the
 * ERC-20 allowance owner remains the smart account rather than the EOA.
 */
export async function prepareSmartAccountTransactions(
  provider: InjectedProvider,
  owner: Address,
  smartAccount: Address,
  market: TradingMarketSnapshot,
  manifest: StrategyManifest,
): Promise<SmartAccountPreparationResult> {
  const { public: client, wallet } = clients(provider, owner)
  const requiredCollateral = parseUnits(manifest.action.maxCollateral, market.collateralDecimals)
  const [accountCode, accountOwner, accountExecutor, accountBalance, accountAllowance, ownerBalance] = await Promise.all([
    client.getCode({ address: smartAccount }),
    client.readContract({ address: smartAccount, abi: circuitSmartAccountAbi, functionName: 'owner' }),
    client.readContract({ address: smartAccount, abi: circuitSmartAccountAbi, functionName: 'executor' }),
    client.readContract({ address: market.collateral, abi: collateralReadAbi, functionName: 'balanceOf', args: [smartAccount] }),
    client.readContract({ address: market.collateral, abi: collateralReadAbi, functionName: 'allowance', args: [smartAccount, market.pool] }),
    client.readContract({ address: market.collateral, abi: collateralReadAbi, functionName: 'balanceOf', args: [owner] }),
  ])
  const deployment = configuredDeployment()
  if (!accountCode || accountCode === '0x' || !deployment || accountExecutor.toLowerCase() !== deployment.engine.toLowerCase()) {
    throw new Error('Smart account is not deployed for the configured CircuitEngine.')
  }
  if (accountOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Smart account owner does not match the connected wallet.')
  }
  if (requiredCollateral <= 0n) throw new Error('Manifest max order collateral must be greater than zero.')

  let currentAccountBalance = accountBalance
  let currentOwnerBalance = ownerBalance
  let faucet: TransactionResult | undefined
  let transfer: TransactionResult | undefined
  let approval: TransactionResult | undefined

  if (currentAccountBalance < requiredCollateral) {
    const deficit = requiredCollateral - currentAccountBalance
    if (currentOwnerBalance < deficit) {
      const mintAmount = deficit - currentOwnerBalance
      transactionUpdate({phase:'signature'})
      const faucetHash = await wallet.writeContract({
        address: market.collateral,
        abi: collateralWriteAbi,
        functionName: 'faucet',
        args: [mintAmount],
      })
      const faucetReceipt = await successfulReceipt(faucetHash)
      faucet = { hash: faucetHash, blockNumber: faucetReceipt.blockNumber }
      currentOwnerBalance = await client.readContract({
        address: market.collateral,
        abi: collateralReadAbi,
        functionName: 'balanceOf',
        args: [owner],
      })
    }
    if (currentOwnerBalance < deficit) {
      throw new Error('Collateral faucet did not provide enough tUSDC to fund the smart account.')
    }
    transactionUpdate({phase:'signature'})
    const transferHash = await wallet.writeContract({
      address: market.collateral,
      abi: collateralWriteAbi,
      functionName: 'transfer',
      args: [smartAccount, deficit],
    })
    const transferReceipt = await successfulReceipt(transferHash)
    transfer = { hash: transferHash, blockNumber: transferReceipt.blockNumber }
    currentAccountBalance += deficit
  }

  if (accountAllowance < requiredCollateral) {
    const approveData = encodeFunctionData({
      abi: collateralWriteAbi,
      functionName: 'approve',
      args: [market.pool, requiredCollateral],
    })
    transactionUpdate({phase:'signature'})
    const approvalHash = await wallet.writeContract({
      address: smartAccount,
      abi: circuitSmartAccountWriteAbi,
      functionName: 'execute',
      args: [market.collateral, 0n, approveData],
    })
    const approvalReceipt = await successfulReceipt(approvalHash)
    approval = { hash: approvalHash, blockNumber: approvalReceipt.blockNumber }
  }

  return { requiredCollateral, faucet, transfer, approval }
}

export async function createSubscriptionTransaction(
  provider: InjectedProvider,
  account: Address,
  deployment: CircuitDeployment,
  market: TradingMarketSnapshot,
  kind: 'fill' | 'resolution' | 'successor' = 'fill',
) {
  const client = clients(provider, account)
  const sdk = new SDK({ public: client.public, wallet: client.wallet })
  let emitter = kind === 'fill' ? market.pool : market.marketAddress
  let topic = kind === 'fill' ? ORDER_FILLED_TOPIC : keccak256(stringToHex('StatusChanged(uint8,uint8)'))
  if (kind === 'successor') {
    if (!DREAMDEX_CONTRACTS.binaryModule) throw new Error('dreamDEX module is not configured.')
    const record = await client.public.readContract({address:DREAMDEX_CONTRACTS.binaryModule,abi:binaryModuleReadAbi,functionName:'markets',args:[market.marketId]})
    emitter = record[7]
    topic = keccak256(stringToHex('MarketCreated(bytes32,address,address,uint256,uint256,address,string,uint256,uint64,uint64,uint256,string,uint64)'))
  }
  transactionUpdate({phase:'signature'})
  const hash = await sdk.subscribe({
    handlerContractAddress: deployment.handler,
    filter: {eventTopics:[topic],emitter},
    options: { priorityFeePerGas: parseGwei('2'), maxFeePerGas: parseGwei('20'), gasLimit: 10_000_000n },
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
  transactionUpdate({phase:'signature'})
  const hash = await wallet.writeContract({
    address: deployment.engine,
    abi: circuitEngineAbi,
    functionName: action,
    args: [strategyId],
  })
  const receipt = await successfulReceipt(hash)
  return { hash, blockNumber: receipt.blockNumber }
}


export async function enableAutomaticRolloverTransaction(provider: InjectedProvider, account: Address, deployment: CircuitDeployment, strategyId: Hex): Promise<TransactionResult> {
  const { wallet } = clients(provider,account)
  transactionUpdate({phase:'signature'})
  const hash = await wallet.writeContract({address:deployment.engine,abi:circuitEngineAbi,functionName:'setAutomaticRollover',args:[strategyId,true]})
  const receipt = await successfulReceipt(hash)
  return {hash,blockNumber:receipt.blockNumber}
}
