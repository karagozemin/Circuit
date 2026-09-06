/** Independently verify real receipts before marking the deployment's live lifecycle complete. */
import { readFile, writeFile } from 'node:fs/promises'
import { createPublicClient, http, decodeFunctionData, parseAbi, type Abi, type Hex } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import engineArtifact from '../contracts/out/CircuitEngine.sol/CircuitEngine.json'
import handlerArtifact from '../contracts/out/CircuitReactivityHandler.sol/CircuitReactivityHandler.json'
import { SHANNON_RPC_URL } from '../src/lib/dreamdex/config'
import { SDK } from '@somnia-chain/reactivity'
import { normalizeSubscriptionInfo } from '../src/lib/contracts/subscription-info'
const directory='deployments/evidence/live-demo'
const proof=JSON.parse(await readFile(`${directory}/proof.json`,'utf8'))
if(!proof.live || !proof.complete || !proof.stage.startsWith('complete'))throw new Error('A complete real lifecycle and cleanup are required.')
const client=createPublicClient({chain:somniaShannon,transport:http(SHANNON_RPC_URL)})
if(await client.getChainId()!==50312)throw new Error('Wrong chain.')
const events:Record<string,any>={}
for(const name of ['StrategyActivated','TriggerMatched','ReactivityCallbackProcessed','OrderExecuted','RoundResolved','RolloverComputed','MarketBound']){
 const event=proof.events.find((e:any)=>e.name===name && e.args.strategyId===proof.strategyId)
 if(!event)throw new Error(`Missing ${name} for this strategy`)
 const [transaction,receipt]=await Promise.all([client.getTransaction({hash:event.hash}),client.getTransactionReceipt({hash:event.hash})])
 if(receipt.status!=='success')throw new Error(`${name} receipt failed`)
 events[name]={...event,transaction,receipt}
}
const callback=events.ReactivityCallbackProcessed
if(callback.hash!==events.TriggerMatched.hash || callback.transaction.to?.toLowerCase()!==proof.handler.toLowerCase())throw new Error('Trigger lacks its real handler callback.')
const decoded=decodeFunctionData({abi:handlerArtifact.abi as Abi,data:callback.transaction.input})
const [emitter,topics,data]=decoded.args as [string,Hex[],Hex]
if(decoded.functionName!=='onEvent' || emitter.toLowerCase()!==proof.market.pool.toLowerCase())throw new Error('Unexpected trigger callback emitter.')
const seed=await client.getTransactionReceipt({hash:proof.transactions.seedFill.hash})
if(!seed.logs.some(log=>log.address.toLowerCase()===emitter.toLowerCase() && log.data===data && JSON.stringify(log.topics)===JSON.stringify(topics)))throw new Error('Callback does not match the real seed fill receipt.')
const orderCall=decodeFunctionData({abi:engineArtifact.abi as Abi,data:events.OrderExecuted.transaction.input})
if(orderCall.functionName!=='executeReadyAction' || orderCall.args?.[0]!==proof.strategyId)throw new Error('Order was not submitted through bounded Engine execution.')
const [config,runtime]=await client.readContract({address:proof.engine,abi:engineArtifact.abi as Abi,functionName:'getStrategy',args:[proof.strategyId]}) as [any,any]
if(runtime.round<2 || runtime.status!==7 || runtime.currentPositionSize!==0n)throw new Error('Expected verified successor, paused with no tracked position.')
const tokenAbi=parseAbi(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'])
const [balance,oldAllowance,nextAllowance]=await Promise.all([
 client.readContract({address:proof.market.collateral,abi:tokenAbi,functionName:'balanceOf',args:[proof.smartAccount]}),
 client.readContract({address:proof.market.collateral,abi:tokenAbi,functionName:'allowance',args:[proof.smartAccount,proof.market.pool]}),
 client.readContract({address:proof.market.collateral,abi:tokenAbi,functionName:'allowance',args:[proof.smartAccount,runtime.currentPool]}),
])
if(oldAllowance!==0n || nextAllowance!==runtime.nextOrderBudget)throw new Error('Successor allowances differ from authorized budget.')
const subscriptions=JSON.parse(await readFile(`${directory}/subscriptions-${proof.engine.toLowerCase()}.json`,'utf8'))
const sdk=new SDK({public:client})
const subscriptionEvidence=[]
for(const [key,value] of Object.entries(subscriptions)){
 const subscription=value as {id:string;hash:Hex}
 const info=normalizeSubscriptionInfo(await sdk.getSubscriptionInfo(BigInt(subscription.id)))
 if(info.subscriptionData.handlerContractAddress.toLowerCase()!==proof.handler.toLowerCase())throw new Error('Subscription handler mismatch.')
 subscriptionEvidence.push({key,...subscription,info})
}
const settlementSource=events.RoundResolved.transaction.to?.toLowerCase()===proof.handler.toLowerCase()?'reactivity callback':'permissionless sync backstop'
const audit={verifiedAt:new Date().toISOString(),network:'Somnia Shannon Testnet',chainId:50312,complete:true,strategyId:proof.strategyId,events,settlementSource,config,runtime,balance,oldAllowance,nextAllowance,subscriptions:subscriptionEvidence}
const stringify=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n'
await writeFile(`${directory}/audit.json`,stringify(audit))
const deployment=JSON.parse(await readFile('deployments/shannon.json','utf8'))
if(deployment.engine.toLowerCase()!==proof.engine.toLowerCase())throw new Error('Public deployment is stale; record the correct deployment before finalizing.')
deployment.preparation={...deployment.preparation,strategyId:proof.strategyId,status:'PAUSED after verified round-2 successor',manifest:proof.manifest,marketId:runtime.currentMarketId,smartAccountBalance:balance,allowance:nextAllowance,allowanceSpender:runtime.currentPool,subscriptions:subscriptionEvidence,verifiedAt:audit.verifiedAt}
deployment.liveLifecycle={complete:true,strategyId:proof.strategyId,callbackEvidence:events.TriggerMatched.hash,orderEvidence:events.OrderExecuted.hash,resolutionEvidence:events.RoundResolved.hash,rolloverEvidence:events.MarketBound.hash,settlementSource,proof:`${directory}/proof.json`,audit:`${directory}/audit.json`,verifiedAt:audit.verifiedAt}
await writeFile('deployments/shannon.json',stringify(deployment))
console.log(stringify(deployment.liveLifecycle))
