/** Replace the paused, unfilled demo fixture with an explicit BUY_UP/below strategy. */
import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { createPublicClient, createWalletClient, http, parseEventLogs, type Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import engineArtifact from '../contracts/out/CircuitEngine.sol/CircuitEngine.json'
import handlerArtifact from '../contracts/out/CircuitReactivityHandler.sol/CircuitReactivityHandler.json'
import { requirePrivateKey } from './private-key'
import { manifestHash, manifestToEngineConfig } from '../src/lib/contracts/engine'
import { SHANNON_RPC_URL } from '../src/lib/dreamdex/config'
if (!process.argv.includes('--execute')) throw new Error('Pass --execute for the explicit replacement fixture.')
const path='deployments/evidence/live-preparation-v2.json'
const prep=JSON.parse(await readFile(path,'utf8'))
if(prep.replacedStrategy)throw new Error('Already revised; inspect receipts rather than repeat.')
const account=privateKeyToAccount(requirePrivateKey(process.env.CIRCUIT_OPERATOR_PRIVATE_KEY))
const client=createPublicClient({chain:somniaShannon,transport:http(SHANNON_RPC_URL)})
const wallet=createWalletClient({account,chain:somniaShannon,transport:http(SHANNON_RPC_URL)})
const abi=engineArtifact.abi as Abi
const [,runtime]=await client.readContract({address:prep.engine,abi,functionName:'getStrategy',args:[prep.strategyId]}) as [unknown,{owner:string;status:number;currentPositionSize:bigint}]
if(await client.getChainId()!==50312 || runtime.owner.toLowerCase()!==account.address.toLowerCase() || runtime.status!==7 || runtime.currentPositionSize!==0n)throw new Error('Requires owner-controlled paused and unfilled Shannon fixture.')
await copyFile('deployments/evidence/live-demo/proof.json','deployments/evidence/live-demo/attempt-1.json')
await copyFile(path,'deployments/evidence/live-preparation-v2-attempt-1.json')
const journal:Record<string,unknown>={}
async function send(name:string,address:any,callAbi:Abi,functionName:string,args:readonly unknown[]){
 const simulation=await client.simulateContract({address,abi:callAbi,functionName,args,account})
 const hash=await wallet.writeContract(simulation.request)
 journal[name]={hash,status:'pending'};await save()
 const receipt=await client.waitForTransactionReceipt({hash})
 journal[name]={hash,status:receipt.status,blockNumber:receipt.blockNumber,logs:receipt.logs};await save()
 if(receipt.status!=='success')throw new Error(`${name} reverted`)
 console.log(name,hash);return receipt
}
async function save(){await writeFile('deployments/evidence/live-demo/fixture-revision.json',JSON.stringify(journal,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n')}
await send('cancelUnfilledFixture',prep.engine,abi,'cancelStrategy',[prep.strategyId])
for(const emitter of [prep.market.pool,prep.market.marketAddress])await send(`unbind-${emitter}`,prep.handler,handlerArtifact.abi as Abi,'unbindMarket',[emitter])
const manifest={...prep.manifest,name:'Live BTC BUY UP below 0.70',trigger:{type:'LAST_FILL_PRICE_BELOW',value:'0.700'},action:{...prep.manifest.action,type:'BUY_UP'}}
const receipt=await send('replacementStrategy',prep.engine,abi,'createStrategy',[manifestHash(manifest),manifestToEngineConfig(manifest)])
const id=(parseEventLogs({abi,logs:receipt.logs,eventName:'StrategyCreated'})[0]?.args as {strategyId?:string}).strategyId
if(!id)throw new Error('Missing replacement strategy ID')
await send('executionAccount',prep.engine,abi,'setExecutionAccount',[id,prep.smartAccount])
await send('binding',prep.engine,abi,'bindMarket',[id,prep.market.marketId,prep.market.marketAddress,prep.market.pool,prep.market.collateral,prep.market.outcomeToken,BigInt(prep.market.yesId)])
await send('automaticRollover',prep.engine,abi,'setAutomaticRollover',[id,true])
prep.replacedStrategy=prep.strategyId;prep.strategyId=id;prep.manifest=manifest;prep.revisionEvidence='deployments/evidence/live-demo/fixture-revision.json'
await writeFile(path,JSON.stringify(prep,null,2)+'\n')
