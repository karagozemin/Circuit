import { readFile, writeFile } from 'node:fs/promises'
import { createPublicClient,createWalletClient,fallback,http,type Abi,type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import artifact from '../contracts/out/CircuitSmartAccount.sol/CircuitSmartAccount.json'
import { requirePrivateKey } from './private-key'
import { SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL } from '../src/lib/dreamdex/config'
const path=process.argv[2]
if (!path) throw new Error('Pass a verified Engine/handler deployment JSON file.')
const deployment=JSON.parse(await readFile(path,'utf8'))
const account=privateKeyToAccount(requirePrivateKey(process.env.CIRCUIT_OPERATOR_PRIVATE_KEY))
const transport=fallback([SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL].map(url=>http(url)))
const client=createPublicClient({chain:somniaShannon,transport})
const wallet=createWalletClient({account,chain:somniaShannon,transport})
if (await client.getChainId()!==50312 || deployment.chainId!==50312 || !(await client.getCode({address:deployment.engine}))) throw new Error('Deployment chain or Engine code invalid.')
const hash=await wallet.deployContract({abi:artifact.abi as Abi,bytecode:artifact.bytecode.object as Hex,args:[account.address,deployment.engine]})
const receipt=await client.waitForTransactionReceipt({hash})
if (receipt.status!=='success' || !receipt.contractAddress) throw new Error(`Account deployment failed: ${hash}`)
deployment.smartAccount=receipt.contractAddress
deployment.transactions.smartAccount=hash
await writeFile(path,JSON.stringify(deployment,null,2)+'\n')
console.log(JSON.stringify({smartAccount:receipt.contractAddress,hash,blockNumber:receipt.blockNumber.toString()}))
