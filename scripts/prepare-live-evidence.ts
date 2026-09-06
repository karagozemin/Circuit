import { readFile, writeFile } from 'node:fs/promises'
import { binaryModuleReadAbi } from '@somnia-chain/markets-sdk'
import { SDK, SomniaReactivityPrecompileABI } from '@somnia-chain/reactivity'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient,createWalletClient,decodeEventLog,encodeFunctionData,fallback,http,keccak256,parseAbi,parseEventLogs,parseGwei,stringToHex,type Abi,type Address,type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import artifact from '../contracts/out/CircuitEngine.sol/CircuitEngine.json'
import { requirePrivateKey } from './private-key'
import { discoverFromChain } from '../src/lib/dreamdex/chain-discovery'
import { SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL } from '../src/lib/dreamdex/config'
import { initialManifest } from '../src/lib/strategy'
import { manifestHash,manifestToEngineConfig } from '../src/lib/contracts/engine'
const deploymentPath=process.argv[2]
if (!deploymentPath || !process.argv.includes('--execute')) throw new Error('Pass deployment JSON and --execute. This prepares an unactivated strategy; it never places an order.')
const deployment=JSON.parse(await readFile(deploymentPath,'utf8'))
const account=privateKeyToAccount(requirePrivateKey(process.env.CIRCUIT_OPERATOR_PRIVATE_KEY))
const transport=fallback([SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL].map(url=>http(url,{timeout:10000,retryCount:0})))
const client=createPublicClient({chain:somniaShannon,transport})
const wallet=createWalletClient({account,chain:somniaShannon,transport})
if (await client.getChainId()!==50312 || deployment.chainId!==50312) throw new Error('Shannon only.')
const engine=deployment.engine as Address, handler=deployment.handler as Address, smartAccount=deployment.smartAccount as Address
const abi=artifact.abi as Abi
const evidencePath=process.argv.find(arg=>arg.startsWith('--evidence='))?.slice('--evidence='.length) ?? 'deployments/evidence/live-preparation.json'
const evidence: Record<string,unknown> = {network:'Somnia Shannon Testnet',chainId:50312,engine,handler,smartAccount,activation:'prepared; activation requires the separate live-demo command',transactions:{}}
async function save() {await writeFile(evidencePath,JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n')}
async function send(name:string,address:Address,callAbi:Abi,functionName:string,args:readonly unknown[]) {
  const simulation=await client.simulateContract({address,abi:callAbi,functionName,args,account})
  const hash=await wallet.writeContract(simulation.request)
  ;(evidence.transactions as Record<string,unknown>)[name]={hash,status:'pending'}
  await save()
  const receipt=await client.waitForTransactionReceipt({hash})
  ;(evidence.transactions as Record<string,unknown>)[name]={hash,status:receipt.status,blockNumber:receipt.blockNumber,logs:receipt.logs}
  await save()
  if (receipt.status!=='success') throw new Error(`${name} reverted: ${hash}`)
  console.log(name,hash)
  return receipt
}
const market=await discoverFromChain({intervalSec:3600})
evidence.market=market
// A small explicit test fixture, independent of the intent compiler. No live order is activated here.
const manifest={...initialManifest,name:'Shannon readiness probe',series:{asset:'BTC' as const,intervalSec:3600 as const},action:{...initialManifest.action,maxCollateral:'1'},policy:{...initialManifest.policy,maxTotalCapitalAtRisk:'2',maxRounds:2}}
evidence.manifest=manifest
const tokenAbi=parseAbi(['function faucet(uint256)','function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)'])
const accountAbi=parseAbi(['function owner() view returns(address)','function executor() view returns(address)','function execute(address,uint256,bytes) returns(bytes)'])
const owner=await client.readContract({address:smartAccount,abi:accountAbi,functionName:'owner'})
const executor=await client.readContract({address:smartAccount,abi:accountAbi,functionName:'executor'})
if (owner.toLowerCase()!==account.address.toLowerCase() || executor.toLowerCase()!==engine.toLowerCase()) throw new Error('Smart account ownership/wiring mismatch.')
const walletBalance=await client.readContract({address:market.collateral,abi:tokenAbi,functionName:'balanceOf',args:[account.address]})
const funds=await client.readContract({address:market.collateral,abi:tokenAbi,functionName:'balanceOf',args:[smartAccount]})
const deficit=2_000_000n>funds?2_000_000n-funds:0n
if (walletBalance<deficit) await send('faucet',market.collateral,tokenAbi,'faucet',[deficit-walletBalance])
if (deficit>0n) await send('funding',market.collateral,tokenAbi,'transfer',[smartAccount,deficit])
await send('approval',smartAccount,accountAbi,'execute',[market.collateral,0n,encodeFunctionData({abi:tokenAbi,functionName:'approve',args:[market.pool,1_000_000n]})])
const created=await send('strategy',engine,abi,'createStrategy',[manifestHash(manifest),manifestToEngineConfig(manifest)])
const id=parseEventLogs({abi:artifact.abi as Abi,logs:created.logs,eventName:'StrategyCreated'})[0]?.args as {strategyId?:Hex}|undefined
if (!id?.strategyId) throw new Error('Missing strategy ID.')
evidence.strategyId=id.strategyId
await send('executionAccount',engine,abi,'setExecutionAccount',[id.strategyId,smartAccount])
await send('binding',engine,abi,'bindMarket',[id.strategyId,market.marketId,market.marketAddress,market.pool,market.collateral,market.outcomeToken,market.noId])
await send('automaticRollover',engine,abi,'setAutomaticRollover',[id.strategyId,true])
const moduleAddress=await client.readContract({address:engine,abi,functionName:'binaryModule'}) as Address
const marketRecord=await client.readContract({address:moduleAddress,abi:binaryModuleReadAbi,functionName:'markets',args:[market.marketId]})
evidence.creator=marketRecord[7]
const sdk=new SDK({public:client,wallet})
const subscriptions=[]
for (const [name,emitter,signature] of [['fill',market.pool,'OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)'],['resolution',market.marketAddress,'StatusChanged(uint8,uint8)'],['successor',marketRecord[7],'MarketCreated(bytes32,address,address,uint256,uint256,address,string,uint256,uint64,uint64,uint256,string,uint64)']] as const) {
  const hash=await sdk.subscribe({handlerContractAddress:handler,filter:{emitter,eventTopics:[keccak256(stringToHex(signature))]},options:{gasLimit:10_000_000n,maxFeePerGas:parseGwei('20'),priorityFeePerGas:parseGwei('2')}})
  if (hash instanceof Error) throw hash
  const receipt=await client.waitForTransactionReceipt({hash})
  if (receipt.status!=='success') throw new Error(`Subscription reverted: ${hash}`)
  for (const log of receipt.logs) {
    let decoded
    try {decoded=decodeEventLog({abi:SomniaReactivityPrecompileABI,data:log.data,topics:log.topics})}catch{continue}
    if (decoded.eventName==='SubscriptionCreated') {
      const info=await sdk.getSubscriptionInfo(decoded.args.subscriptionId)
      if (info instanceof Error) throw info
      subscriptions.push({kind:name,id:decoded.args.subscriptionId,hash,blockNumber:receipt.blockNumber,emitter,topic:keccak256(stringToHex(signature)),info})
    }
  }
  evidence.subscriptions=subscriptions
  await save()
  console.log('subscription',name,hash)
}
evidence.smartAccountBalance=await client.readContract({address:market.collateral,abi:tokenAbi,functionName:'balanceOf',args:[smartAccount]})
evidence.allowance=await client.readContract({address:market.collateral,abi:tokenAbi,functionName:'allowance',args:[smartAccount,market.pool]})
evidence.ownerNativeBalance=await client.getBalance({address:account.address})
evidence.verifiedAt=new Date().toISOString()
await save()
console.log('Prepared and verified. Strategy remains VALIDATED; no live order or hour-long wait started.')
process.exit(0)
