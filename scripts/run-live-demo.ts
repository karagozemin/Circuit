/** Real Shannon demonstration using explicit, owner-controlled test liquidity. Never fabricates market state/callbacks. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { SDK } from '@somnia-chain/reactivity'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient,createWalletClient,encodeFunctionData,fallback,http,parseAbi,parseEventLogs,type Abi,type Address,type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import engineArtifact from '../contracts/out/CircuitEngine.sol/CircuitEngine.json'
import handlerArtifact from '../contracts/out/CircuitReactivityHandler.sol/CircuitReactivityHandler.json'
import { requirePrivateKey } from './private-key'
import { SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL } from '../src/lib/dreamdex/config'
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the bounded real testnet demo.')
const resumeRun=process.argv.includes('--resume')
const existingBook=process.argv.includes('--existing-book')
const prep=JSON.parse(await readFile('deployments/evidence/live-preparation-v2.json','utf8'))
const previous=JSON.parse(await readFile('deployments/evidence/live-preparation.json','utf8'))
const directory='deployments/evidence/live-demo'
await mkdir(directory,{recursive:true})
const key=requirePrivateKey(process.env.CIRCUIT_OPERATOR_PRIVATE_KEY)
const account=privateKeyToAccount(key)
const transport=fallback([SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL].map(url=>http(url,{timeout:10000,retryCount:0})))
const client=createPublicClient({chain:somniaShannon,transport})
const wallet=createWalletClient({account,chain:somniaShannon,transport})
if(await client.getChainId()!==50312)throw new Error('Shannon testnet only.')
const engine=prep.engine as Address,handler=prep.handler as Address,smartAccount=prep.smartAccount as Address,maker=previous.smartAccount as Address,id=prep.strategyId as Hex
const engineAbi=engineArtifact.abi as Abi
const accountAbi=parseAbi(['function owner() view returns(address)','function execute(address,uint256,bytes) returns(bytes)'])
const tokenAbi=parseAbi(['function faucet(uint256)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'])
const outcomeAbi=parseAbi(['function approve(address,uint256,uint256) returns(bool)','function balanceOf(address,uint256) view returns(uint256)'])
const poolAbi=parseAbi(['function placeBinaryOrder(uint8,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64) payable returns(bool,uint128)','event OrderFilled(uint128 indexed takerOrderId,uint128 indexed makerOrderId,uint256 quantityFilled,uint256 takerRemaining,uint256 makerRemaining,uint256 fillPrice)'])
const moduleAbi=parseAbi(['function redeem(uint32,bytes32,bytes32,uint8,uint256)'])
const zero='0x0000000000000000000000000000000000000000' as Address
const zeroHash=('0x'+'0'.repeat(64)) as Hex
const proof:Record<string,any>=resumeRun?JSON.parse(await readFile(`${directory}/proof.json`,'utf8')):{network:'Somnia Shannon Testnet',chainId:50312,live:true,complete:false,controlledTestLiquidity:!existingBook,liquidityDisclosure:existingBook?'Seed BUY UP and keeper order use existing public book liquidity. Test taker accounts are owner controlled.':'Maker smart account and seed taker are controlled by the same owner. These are real protocol transactions with test collateral, not organic market demand.',engine,handler,smartAccount,maker,strategyId:id,manifest:prep.manifest,market:prep.market,transactions:{},events:[],startedAt:new Date().toISOString(),stage:'preparing'}
const stringify=(v:unknown)=>JSON.stringify(v,(_,item)=>typeof item==='bigint'?item.toString():item,2)
async function save(){await writeFile(`${directory}/proof.json`,stringify(proof)+'\n')}
async function send(name:string,address:Address,abi:Abi,functionName:string,args:readonly unknown[]) {
 const simulation=await client.simulateContract({address,abi,functionName,args,account})
 const hash=await wallet.writeContract(simulation.request)
 proof.transactions[name]={hash,status:'pending'};await save()
 const receipt=await client.waitForTransactionReceipt({hash,timeout:120000})
 proof.transactions[name]={hash,status:receipt.status,blockNumber:receipt.blockNumber,logs:receipt.logs};await save()
 if(receipt.status!=='success')throw new Error(`${name} reverted: ${hash}`)
 console.log(name,hash)
 return receipt
}
async function accountCall(name:string,holder:Address,target:Address,abi:Abi,functionName:string,args:readonly unknown[]) {
 return send(name,holder,accountAbi,'execute',[target,0n,encodeFunctionData({abi,functionName,args})])
}
let keeper:ChildProcess|undefined
let activationStarted=false
let shuttingDown=false
async function stopKeeper(){if(keeper && keeper.exitCode===null){keeper.kill('SIGTERM');await new Promise(resolve=>keeper!.once('exit',resolve))}keeper=undefined}
async function pause(){if(activationStarted){const [,runtime]=await client.readContract({address:engine,abi:engineAbi,functionName:'getStrategy',args:[id]}) as [unknown,{status:number}];if([2,3,4,5,6].includes(runtime.status))await send('pauseAfterDemo',engine,engineAbi,'pauseStrategy',[id])}}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{shuttingDown=true;void(async()=>{await stopKeeper();await pause();proof.stage='interrupted and paused';await save();process.exit(1)})()})
try {
 for(const address of [maker,smartAccount])if((await client.readContract({address,abi:accountAbi,functionName:'owner'})).toLowerCase()!==account.address.toLowerCase())throw new Error('Fixture account owner mismatch')
 let cursor:bigint
 if(resumeRun){
  if(proof.strategyId!==id||proof.engine.toLowerCase()!==engine.toLowerCase()||proof.complete)throw new Error('Resume evidence does not match the pending strategy.')
  const [,runtime]=await client.readContract({address:engine,abi:engineAbi,functionName:'getStrategy',args:[id]}) as [unknown,{status:number}]
  activationStarted=true
  if(runtime.status===7)await send('resumeAfterKeeperFix',engine,engineAbi,'resumeStrategy',[id])
  else if(![2,3,4,5,6].includes(runtime.status))throw new Error('Strategy is not resumable.')
  cursor=BigInt(proof.transactions.activation.blockNumber)
  proof.restartedAt=new Date().toISOString()
 }else{
 const secondsLeft=Number(prep.market.expiry)-(Number((await client.getBlock()).timestamp))
 if(secondsLeft<180 || secondsLeft>1800)throw new Error(`Demo requires an existing window with 3–30 minutes left; got ${secondsLeft}s. No hour-long wait is started.`)
 // Retire the previous unactivated preparation before reusing its account as controlled liquidity.
 if(!existingBook){
 await send('cancelPreviousPreparation',previous.engine,engineAbi,'cancelStrategy',[previous.strategyId])
 const sdk=new SDK({public:client,wallet})
 for(const subscription of previous.subscriptions){const hash=await sdk.unsubscribe(BigInt(subscription.id));if(hash instanceof Error)throw hash;const receipt=await client.waitForTransactionReceipt({hash});proof.transactions[`retireSubscription${subscription.id}`]={hash,status:receipt.status,blockNumber:receipt.blockNumber};await save()}
 const makerBalance=await client.readContract({address:prep.market.collateral,abi:tokenAbi,functionName:'balanceOf',args:[maker]})
 if(makerBalance<1_500_000n)throw new Error('Maker fixture needs 1.5 test collateral; refusing to invent additional funding.')
 await accountCall('makerApproval',maker,prep.market.collateral,tokenAbi,'approve',[prep.market.pool,1_500_000n])
 }
 const ownerCollateral=await client.readContract({address:prep.market.collateral,abi:tokenAbi,functionName:'balanceOf',args:[account.address]})
 if(ownerCollateral<25_000n)await send('seedFaucet',prep.market.collateral,tokenAbi,'faucet',[25_000n-ownerCollateral])
 await send('seedApproval',prep.market.collateral,tokenAbi,'approve',[prep.market.pool,25_000n])
 const armed=await send('activation',engine,engineAbi,'activateStrategy',[id]);activationStarted=true
 cursor=armed.blockNumber
 const expiryNs=BigInt(prep.market.expiry)*1_000_000_000n
 // BUY UP maker at YES=0.75; BUY DOWN seed at YES=0.75 consumes 0.1 share and emits a genuine fill.
 if(existingBook){
  if(prep.manifest.action.type!=='BUY_UP'||prep.manifest.trigger.type!=='LAST_FILL_PRICE_BELOW')throw new Error('Existing-book fixture must explicitly authorize BUY_UP/below.')
  await send('seedFill',prep.market.pool,poolAbi,'placeBinaryOrder',[0,700_000n,10_000n,expiryNs,2,0,zero,0n,78n])
 }else{
 await accountCall('controlledMakerOrder',maker,prep.market.pool,poolAbi,'placeBinaryOrder',[0,750_000n,2_000_000n,expiryNs,0,0,zero,0n,77n])
 await send('seedFill',prep.market.pool,poolAbi,'placeBinaryOrder',[2,750_000n,100_000n,expiryNs,2,0,zero,0n,78n])
 }
 }
 const subscriptions:Record<string,unknown>={}
 for(const sub of prep.subscriptions)subscriptions[`${sub.emitter.toLowerCase()}:${sub.topic}`]={id:sub.id,hash:sub.hash}
 await writeFile(`${directory}/subscriptions-${engine.toLowerCase()}.json`,stringify(subscriptions)+'\n')
 keeper=spawn(process.execPath,['--import','tsx','scripts/keeper.ts','--execute'],{env:{...process.env,CIRCUIT_ENGINE_ADDRESS:engine,CIRCUIT_HANDLER_ADDRESS:handler,CIRCUIT_STRATEGY_IDS:id,CIRCUIT_EVIDENCE_DIR:directory},stdio:['ignore','pipe','pipe']})
 keeper.stdout?.on('data',chunk=>{const lines=String(chunk).trim().split('\n');for(const line of lines){try{const event=JSON.parse(line);if(event.kind==='receipt'||event.kind==='error'||event.kind==='AUTOMATION_PAUSED')console.log('keeper',event.kind,JSON.stringify(event.data))}catch{}}})
 keeper.stderr?.on('data',chunk=>console.error('keeper',String(chunk)))
 proof.stage='waiting for real callback and keeper';await save()
 const eventsAbi=[...engineAbi,...handlerArtifact.abi,...poolAbi] as Abi
 const seen=new Set<string>(proof.events.map((event:any)=>`${event.hash}:${event.logIndex}`))
 let lastStage=''
 while(Number((await client.getBlock()).timestamp)<Number(prep.market.expiry)+600) {
  if(shuttingDown){await new Promise(resolve=>setTimeout(resolve,100));continue}
  if(keeper.exitCode!==null)throw new Error(`Keeper exited early: ${keeper.exitCode}`)
  const head=await client.getBlockNumber()
  while(cursor<=head){const end=cursor+999n<head?cursor+999n:head;const logs=await client.getLogs({address:[engine,handler,prep.market.pool],fromBlock:cursor,toBlock:end});for(const event of parseEventLogs({abi:eventsAbi,logs})){const eventKey=`${event.transactionHash}:${event.logIndex}`;if(!seen.has(eventKey)){seen.add(eventKey);proof.events.push({name:event.eventName,args:event.args,address:event.address,hash:event.transactionHash,blockNumber:event.blockNumber,logIndex:event.logIndex})}}cursor=end+1n}
  const [config,runtime]=await client.readContract({address:engine,abi:engineAbi,functionName:'getStrategy',args:[id]}) as [any,any]
  proof.config=config;proof.runtime=runtime;proof.observedAt=new Date().toISOString()
  proof.stage=runtime.round>=2?'successor armed':runtime.status===5?'waiting for real market resolution':runtime.status===3?'trigger verified; keeper executing':'waiting for real market activity'
  if(proof.stage!==lastStage){console.log(proof.stage);lastStage=proof.stage}
  await save()
  if(runtime.round>=2 && runtime.status===2){
   const names=proof.events.map((event:any)=>event.name)
   if(!names.includes('TriggerMatched')||!names.includes('OrderExecuted')||!names.includes('RoundResolved')||!names.includes('RolloverComputed'))throw new Error('Successor state lacks required lifecycle event proof')
   proof.complete=true;proof.completedAt=new Date().toISOString();await save()
   await stopKeeper();await pause()
   // Return the controlled test liquidity through the actual settlement module, including losing burns.
   const module=await client.readContract({address:engine,abi:engineAbi,functionName:'binaryModule'}) as Address
   const makerPosition=await client.readContract({address:prep.market.outcomeToken,abi:outcomeAbi,functionName:'balanceOf',args:[maker,BigInt(prep.market.yesId)]})
   if(makerPosition>0n){await accountCall('makerRedeemApproval',maker,prep.market.outcomeToken,outcomeAbi,'approve',[module,BigInt(prep.market.yesId),makerPosition]);await accountCall('makerRedeem',maker,module,moduleAbi,'redeem',[0,zeroHash,prep.market.marketId,0,makerPosition])}
   const seedPosition=await client.readContract({address:prep.market.outcomeToken,abi:outcomeAbi,functionName:'balanceOf',args:[account.address,BigInt(existingBook?prep.market.yesId:prep.market.noId)]})
   if(seedPosition>0n){await send('seedRedeemApproval',prep.market.outcomeToken,outcomeAbi,'approve',[module,BigInt(existingBook?prep.market.yesId:prep.market.noId),seedPosition]);await send('seedRedeem',module,moduleAbi,'redeem',[0,zeroHash,prep.market.marketId,existingBook?0:1,seedPosition])}
   proof.stage='complete — paused after verified successor; test liquidity redeemed';await save();console.log('LIVE LIFECYCLE COMPLETE');process.exit(0)
  }
  await new Promise(resolve=>setTimeout(resolve,3000))
 }
 throw new Error('Real market did not complete the lifecycle within expiry + 10 minutes.')
} catch(error) {
 await stopKeeper();await pause();proof.stage='blocked and paused';proof.error=error instanceof Error?error.message:String(error);await save();console.error(proof.error);process.exit(1)
}
