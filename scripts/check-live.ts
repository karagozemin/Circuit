import { createPublicClient, fallback, http, parseAbi, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { requirePrivateKey } from './private-key'
import { DREAMDEX_CONTRACTS, SHANNON_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_DIAGNOSTIC_RPC_URL } from '../src/lib/dreamdex/config'
const client = createPublicClient({ chain: somniaShannon, transport: fallback([http(SHANNON_RPC_URL, {timeout: 10000, retryCount: 0}), http(SHANNON_FALLBACK_RPC_URL, {timeout: 10000, retryCount: 0}), http(SHANNON_DIAGNOSTIC_RPC_URL, {timeout: 10000, retryCount: 0})]) })
const account = privateKeyToAccount(requirePrivateKey(process.env.CIRCUIT_OPERATOR_PRIVATE_KEY))
const balance = await client.getBalance({address: account.address})
if (!DREAMDEX_CONTRACTS.collateral) throw new Error('Collateral address unavailable.')
const token = await client.readContract({address: DREAMDEX_CONTRACTS.collateral, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName:'balanceOf', args:[account.address]})
console.log(JSON.stringify({owner:account.address, balanceSTT:formatEther(balance), collateral:token.toString(), chainId:await client.getChainId()}))
