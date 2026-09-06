import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, createWalletClient, fallback, http, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import smartAccountArtifact from '../contracts/out/CircuitSmartAccount.sol/CircuitSmartAccount.json'
import { SHANNON_DIAGNOSTIC_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_RPC_URL } from '../src/lib/dreamdex/config'
import { requirePrivateKey } from './private-key'

const privateKey = requirePrivateKey(process.env.CIRCUIT_OPERATOR_PRIVATE_KEY)
const engine = process.env.CIRCUIT_ENGINE_ADDRESS ?? process.env.VITE_CIRCUIT_ENGINE_ADDRESS
if (!engine || !/^0x[0-9a-fA-F]{40}$/.test(engine)) throw new Error('Set CIRCUIT_ENGINE_ADDRESS or VITE_CIRCUIT_ENGINE_ADDRESS to the deployed Engine.')

const account = privateKeyToAccount(privateKey)
const transport = fallback([http(SHANNON_RPC_URL), http(SHANNON_FALLBACK_RPC_URL), http(SHANNON_DIAGNOSTIC_RPC_URL)])
const publicClient = createPublicClient({ chain: somniaShannon, transport })
const walletClient = createWalletClient({ account, chain: somniaShannon, transport })

const hash = await walletClient.deployContract({
  abi: smartAccountArtifact.abi as Abi,
  bytecode: smartAccountArtifact.bytecode.object as Hex,
  args: [account.address, engine as Address],
})
const receipt = await publicClient.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('CircuitSmartAccount deployment reverted.')

console.log(JSON.stringify({
  owner: account.address,
  executor: engine,
  smartAccount: receipt.contractAddress,
  transaction: hash,
  next: `VITE_CIRCUIT_SMART_ACCOUNT_ADDRESS=${receipt.contractAddress}`,
}, null, 2))
