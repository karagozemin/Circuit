/** Deploy the short-window runtime on Shannon; journal transactions before waiting. */
import { readFile, writeFile, rename } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createPublicClient, createWalletClient, fallback, http, encodeDeployData, getContractAddress, keccak256, formatEther, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { requirePrivateKey } from './private-key'
import { DREAMDEX_CONTRACTS, SHANNON_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_DIAGNOSTIC_RPC_URL } from '../src/lib/dreamdex/config'
import { initialManifest, changeMarketWindow } from '../src/lib/strategy'
import { manifestHash, manifestToEngineConfig } from '../src/lib/contracts/engine'

type Kind = 'engine' | 'handler' | 'smartAccount'
type Artifact = { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex; immutableReferences?: Record<string, { start: number; length: number }[]> } }
type Transaction = { hash: Hex; status?: string; blockNumber?: string; gasUsed?: string; gasCostSTT?: string }
const path = 'deployments/shannon-short-windows.json'
const artifacts = Object.fromEntries(await Promise.all(([
  ['engine', 'CircuitEngine'], ['handler', 'CircuitReactivityHandler'], ['smartAccount', 'CircuitSmartAccount'],
] as const).map(async ([kind, name]) => [kind, JSON.parse(await readFile(`contracts/out/${name}.sol/${name}.json`, 'utf8'))]))) as Record<Kind, Artifact>
const account = privateKeyToAccount(requirePrivateKey(process.env.CIRCUIT_OPERATOR_PRIVATE_KEY))
const transport = fallback([SHANNON_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_DIAGNOSTIC_RPC_URL].map(url => http(url, { timeout: 15000, retryCount: 0 })))
const client = createPublicClient({ chain: somniaShannon, transport })
const wallet = createWalletClient({ account, chain: somniaShannon, transport })
const binaryModule = DREAMDEX_CONTRACTS.binaryModule
if (!binaryModule) throw new Error('Binary module is not configured.')
if (await client.getChainId() !== 50312) throw new Error('Expected Shannon testnet (50312).')
if (!(await client.getCode({ address: binaryModule }))) throw new Error('Binary module is missing.')
const creationCodeHashes = Object.fromEntries(Object.entries(artifacts).map(([kind, artifact]) => [kind, keccak256(artifact.bytecode.object)]))
let record: {
  network: string; chainId: number; admin: Address; startedAt: string; sourceCommit: string;
  previousDeployment: string; creationCodeHashes: Record<string, Hex>; transactions: Record<string, Transaction>;
  engine?: Address; handler?: Address; smartAccount?: Address; codeHashes?: Record<string, Hex>;
  verifiedAt?: string; verification?: Record<string, unknown>; totalGasCostSTT?: string;
} = {
  network: 'Somnia Shannon Testnet', chainId: 50312, admin: account.address,
  startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  previousDeployment: 'deployments/shannon-programmable.json', creationCodeHashes, transactions: {},
}
try {
  const existing = JSON.parse(await readFile(path, 'utf8')) as typeof record
  if (existing.admin.toLowerCase() !== account.address.toLowerCase() || JSON.stringify(existing.creationCodeHashes) !== JSON.stringify(creationCodeHashes)) throw new Error('Existing journal belongs to a different signer or build.')
  record = existing
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
const save = async () => { await writeFile(`${path}.tmp`, JSON.stringify(record, null, 2) + '\n'); await rename(`${path}.tmp`, path) }
const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' })
const predictedEngine = record.engine ?? getContractAddress({ from: account.address, nonce: BigInt(nonce) })
const args: Record<Kind, unknown[]> = {
  engine: [account.address, account.address, binaryModule],
  handler: [account.address, predictedEngine], smartAccount: [account.address, predictedEngine],
}
const gasPrice = await client.getGasPrice()
const estimates = await Promise.all((['engine', 'handler', 'smartAccount'] as const).map(async kind => record.transactions[kind] ? 0n : client.estimateGas({ account: account.address, data: encodeDeployData({ abi: artifacts[kind].abi, bytecode: artifacts[kind].bytecode.object, args: args[kind] }) })))
const gasBudget = (estimates.reduce((sum, gas) => sum + gas, 100000n) * gasPrice * 2n)
const balance = await client.getBalance({ address: account.address })
console.log(JSON.stringify({ chainId: 50312, deployer: account.address, balanceSTT: formatEther(balance), gasBudgetSTT: formatEther(gasBudget), execute: process.argv.includes('--execute') }))
if (balance < gasBudget) throw new Error('Insufficient testnet gas balance.')
if (!process.argv.includes('--execute')) process.exit(0)
await save()
async function receipt(label: string, submit: () => Promise<Hex>) {
  if (!record.transactions[label]) { record.transactions[label] = { hash: await submit() }; await save() }
  const result = await client.waitForTransactionReceipt({ hash: record.transactions[label].hash })
  record.transactions[label] = { hash: result.transactionHash, status: result.status, blockNumber: String(result.blockNumber), gasUsed: String(result.gasUsed), gasCostSTT: formatEther(result.gasUsed * result.effectiveGasPrice) }
  await save()
  if (result.status !== 'success') throw new Error(`${label} reverted: ${result.transactionHash}`)
  return result
}
for (const kind of ['engine', 'handler', 'smartAccount'] as const) {
  if (kind !== 'engine') args[kind] = [account.address, record.engine!]
  const result = await receipt(kind, () => wallet.deployContract({ abi: artifacts[kind].abi, bytecode: artifacts[kind].bytecode.object, args: args[kind] }))
  if (!result.contractAddress) throw new Error(`${kind} address missing`)
  record[kind] = result.contractAddress
  await save()
  console.log(JSON.stringify({ deployed: kind, address: record[kind], hash: result.transactionHash }))
}
await receipt('wiring', async () => {
  const { request } = await client.simulateContract({ account, address: record.engine!, abi: artifacts.engine.abi, functionName: 'setReactivityHandler', args: [record.handler!] })
  return wallet.writeContract(request)
})
async function read(kind: Kind, functionName: string) { return client.readContract({ address: record[kind]!, abi: artifacts[kind].abi, functionName }) }
for (const [kind, field, expected] of [
  ['engine', 'admin', account.address], ['engine', 'binaryModule', binaryModule], ['engine', 'reactivityHandler', record.handler!],
  ['handler', 'owner', account.address], ['handler', 'engine', record.engine!],
  ['smartAccount', 'owner', account.address], ['smartAccount', 'executor', record.engine!],
] as const) if (String(await read(kind, field)).toLowerCase() !== expected.toLowerCase()) throw new Error(`${kind}.${field} mismatch`)
record.codeHashes = {}
for (const kind of ['engine', 'handler', 'smartAccount'] as const) {
  const code = await client.getCode({ address: record[kind]! })
  if (!code || code === '0x') throw new Error(`${kind} runtime missing`)
  // Constructor immutables differ from the zero placeholders in the local artifact.
  const normalize = (value: Hex) => {
    let hex = value.slice(2)
    for (const ranges of Object.values(artifacts[kind].deployedBytecode.immutableReferences ?? {})) for (const { start, length } of ranges) hex = hex.slice(0, start * 2) + '0'.repeat(length * 2) + hex.slice((start + length) * 2)
    return hex
  }
  if (normalize(code) !== normalize(artifacts[kind].deployedBytecode.object)) throw new Error(`${kind} runtime differs from the compiled artifact`)
  record.codeHashes[kind] = keccak256(code)
}
for (const interval of [60, 300, 900] as const) {
  const manifest = changeMarketWindow(initialManifest, interval)
  await client.simulateContract({ account, address: record.engine!, abi: artifacts.engine.abi, functionName: 'createStrategy', args: [manifestHash(manifest), manifestToEngineConfig(manifest)] })
}
const activationSetupVersion = Number(await read('engine', 'activationSetupVersion'))
const ladderSetupVersion = Number(await read('engine', 'ladderSetupVersion'))
if (activationSetupVersion !== 1 || ladderSetupVersion !== 1) throw new Error('Setup version mismatch')
record.verifiedAt = new Date().toISOString()
record.verification = { runtimeMatchesLocalArtifacts: true, ownershipAndWiring: true, simulatedIntervalsSec: [60, 300, 900], activationSetupVersion, ladderSetupVersion, smartAccountPrepared: false, liveLifecycleComplete: false, scope: 'Deployment, wiring and read-only strategy creation simulations. No strategy activation, funding, subscriptions or orders.' }
const receipts = await Promise.all(Object.values(record.transactions).map(tx => client.getTransactionReceipt({ hash: tx.hash })))
record.totalGasCostSTT = formatEther(receipts.reduce((sum, tx) => sum + tx.gasUsed * tx.effectiveGasPrice, 0n))
await save()
// Change public runtime addresses only after all verification succeeds.
let env = await readFile('.env.local', 'utf8')
for (const [name, value] of Object.entries({ VITE_CIRCUIT_ENGINE_ADDRESS: record.engine, VITE_CIRCUIT_HANDLER_ADDRESS: record.handler, VITE_CIRCUIT_SMART_ACCOUNT_ADDRESS: record.smartAccount })) {
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  env = pattern.test(env) ? env.replace(pattern, `${name}=${value}`) : `${env.trimEnd()}\n${name}=${value}\n`
  const keeperName = name.replace(/^VITE_/, '')
  env = env.replace(new RegExp(`^${keeperName}=.*$`, 'm'), `${keeperName}=${value}`)
}
await writeFile('.env.local', env, { mode: 0o600 })
console.log(JSON.stringify({ verified: true, deployment: path, engine: record.engine, handler: record.handler, smartAccount: record.smartAccount, totalGasCostSTT: record.totalGasCostSTT, environmentUpdated: true }))
