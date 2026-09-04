import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, createWalletClient, fallback, http, isAddress, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import engineArtifact from '../contracts/out/CircuitEngine.sol/CircuitEngine.json'
import handlerArtifact from '../contracts/out/CircuitReactivityHandler.sol/CircuitReactivityHandler.json'
import { SHANNON_DIAGNOSTIC_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_RPC_URL } from '../src/lib/dreamdex/config'

const privateKey = process.env.CIRCUIT_OPERATOR_PRIVATE_KEY as Hex | undefined
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('CIRCUIT_OPERATOR_PRIVATE_KEY must be a 32-byte deployer key. Never expose it as VITE_* or commit it.')
}

const account = privateKeyToAccount(privateKey)
const transport = fallback([
  http(SHANNON_RPC_URL),
  http(SHANNON_FALLBACK_RPC_URL),
  http(SHANNON_DIAGNOSTIC_RPC_URL),
])
const publicClient = createPublicClient({ chain: somniaShannon, transport })
const walletClient = createWalletClient({ account, chain: somniaShannon, transport })

const chainId = await publicClient.getChainId()
if (chainId !== somniaShannon.id) throw new Error(`Expected Shannon chain ${somniaShannon.id}, received ${chainId}.`)

const balance = await publicClient.getBalance({ address: account.address })
if (balance === 0n) throw new Error(`Deployer ${account.address} has no STT for deployment gas.`)

const engineHash = await walletClient.deployContract({
  abi: engineArtifact.abi as Abi,
  bytecode: engineArtifact.bytecode.object as Hex,
  args: [account.address, account.address],
})
const engineReceipt = await publicClient.waitForTransactionReceipt({ hash: engineHash })
if (engineReceipt.status !== 'success' || !engineReceipt.contractAddress) throw new Error('CircuitEngine deployment reverted.')
const engine = engineReceipt.contractAddress

const handlerHash = await walletClient.deployContract({
  abi: handlerArtifact.abi as Abi,
  bytecode: handlerArtifact.bytecode.object as Hex,
  args: [account.address, engine],
})
const handlerReceipt = await publicClient.waitForTransactionReceipt({ hash: handlerHash })
if (handlerReceipt.status !== 'success' || !handlerReceipt.contractAddress) throw new Error('CircuitReactivityHandler deployment reverted.')
const handler = handlerReceipt.contractAddress

const wireHash = await walletClient.writeContract({
  address: engine,
  abi: engineArtifact.abi as Abi,
  functionName: 'setReactivityHandler',
  args: [handler],
})
const wireReceipt = await publicClient.waitForTransactionReceipt({ hash: wireHash })
if (wireReceipt.status !== 'success') throw new Error('Engine-handler wiring transaction reverted.')

const wiredHandler = await publicClient.readContract({
  address: engine,
  abi: engineArtifact.abi as Abi,
  functionName: 'reactivityHandler',
}) as Address
if (!isAddress(wiredHandler) || wiredHandler.toLowerCase() !== handler.toLowerCase()) {
  throw new Error('Post-deployment Engine-handler verification failed.')
}

console.log(JSON.stringify({
  chainId,
  admin: account.address,
  engine,
  handler,
  transactions: { engine: engineHash, handler: handlerHash, wiring: wireHash },
  next: [
    `VITE_CIRCUIT_ENGINE_ADDRESS=${engine}`,
    `VITE_CIRCUIT_HANDLER_ADDRESS=${handler}`,
    `npm run spike:operator -- --owner=${account.address} --operator=${engine}`,
  ],
}, null, 2))
