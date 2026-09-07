/** LOCAL ONLY: compile the three shipped graphs, then run them on one Engine with mock markets. */
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {readFile,writeFile} from 'node:fs/promises'
import {createPublicClient,createWalletClient,defineChain,http,encodeAbiParameters,parseAbiParameters,parseEventLogs,keccak256,stringToHex,toHex,formatUnits,parseUnits,type Abi,type Address,type Hex} from 'viem'
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts'
import {templateCatalog} from '../src/lib/workspace'
import {compileGraph,manifestGraph} from '../src/lib/graph'
import {manifestHash,manifestToEngineConfig} from '../src/lib/contracts/engine'

type Contract={address:Address;abi:Abi}
type Runtime={manifestHash:Hex;status:number;round:number;currentPositionSize:bigint;nextOrderBudget:bigint;cumulativeCapitalUsed:bigint;consecutiveLosses:number}
const socket=createServer()
await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve))
const port=(socket.address() as {port:number}).port
await new Promise<void>(resolve=>socket.close(()=>resolve()))
const url=`http://127.0.0.1:${port}`
const chain=defineChain({id:31337,name:'Local Anvil — mock venue',nativeCurrency:{name:'Local Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[url]}}})
const server=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--silent'],{stdio:'ignore'})
let spawnError:Error|undefined
server.on('error',error=>{spawnError=error})
const signer=privateKeyToAccount(generatePrivateKey())
const client=createPublicClient({chain,transport:http(url,{retryCount:0,timeout:3000})})
const wallet=createWalletClient({account:signer,chain,transport:http(url)})
const transactions:{label:string;hash:Hex;block:string}[]=[]
async function rpc(method:string,params:unknown[]) {
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
 const result=await response.json();if(result.error)throw new Error(result.error.message);return result.result
}
async function artifact(name:string,source=name){return JSON.parse(await readFile(`contracts/out/${source}.sol/${name}.json`,'utf8')) as {abi:Abi;bytecode:{object:Hex}}}
async function deploy(name:string,args:unknown[]=[],source=name):Promise<Contract>{
 const compiled=await artifact(name,source);const hash=await wallet.deployContract({abi:compiled.abi,bytecode:compiled.bytecode.object,args})
 const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success'||!receipt.contractAddress)throw new Error(`${name} deployment failed`)
 transactions.push({label:`deploy ${name}`,hash,block:String(receipt.blockNumber)})
 return {address:receipt.contractAddress,abi:compiled.abi}
}
async function send(contract:Contract,functionName:string,args:unknown[]=[]) {
 const {request}=await client.simulateContract({...contract,functionName,args,account:signer})
 const hash=await wallet.writeContract(request);const receipt=await client.waitForTransactionReceipt({hash})
 if(receipt.status!=='success')throw new Error(`${functionName} reverted`)
 transactions.push({label:functionName,hash,block:String(receipt.blockNumber)});return receipt
}
try {
 let ready=false
 for(let i=0;i<50;i++){if(spawnError)throw spawnError;if(server.exitCode!==null)throw new Error('Anvil exited');try{if(await client.getChainId()===31337){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
 if(!ready)throw new Error('Local Anvil did not start')
 await rpc('anvil_setBalance',[signer.address,toHex(100n*10n**18n)])
 const collateral=await deploy('MockCollateral',[],'CircuitEngine.t')
 const outcome=await deploy('MockOutcome',[],'CircuitEngine.t')
 const dummyPool=await deploy('MockBinaryPool',[collateral.address,outcome.address],'CircuitEngine.t')
 const dummyMarket=await deploy('MockBinaryMarket',[dummyPool.address,collateral.address,outcome.address,(await client.getBlock()).timestamp+900n],'CircuitEngine.t')
 const module=await deploy('MockBinaryModule',[dummyMarket.address,collateral.address,outcome.address],'CircuitEngine.t')
 // This is the ONLY Engine and handler deployment in the experiment.
 const engine=await deploy('CircuitEngine',[signer.address,signer.address,module.address])
 const handler=await deploy('CircuitReactivityHandler',[signer.address,engine.address])
 await send(engine,'setReactivityHandler',[handler.address])
 const precompile='0x0000000000000000000000000000000000000100' as Address
 await rpc('anvil_impersonateAccount',[precompile]);await rpc('anvil_setBalance',[precompile,toHex(100n*10n**18n)])
 const dispatcher=createWalletClient({account:precompile,chain,transport:http(url)})
 async function callback(emitter:Address,topics:Hex[],data:Hex){
  const hash=await dispatcher.writeContract({...handler,functionName:'onEvent',args:[emitter,topics,data]})
  const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw new Error('Mock validator callback failed')
  transactions.push({label:'local mock validator dispatch',hash,block:String(receipt.blockNumber)});return hash
 }
 const results=[]
 let sequence=0
 for(const template of templateCatalog){
  const graph=manifestGraph(template.manifest),compilation=compileGraph(graph)
  if(!compilation.ok)throw new Error(compilation.errors.join('; '))
  const manifest=compilation.manifest,config=manifestToEngineConfig(manifest)
  const broken=compileGraph({...graph,edges:graph.edges.filter(edge=>!(edge.from==='win_loss'&&edge.port==='loss'))})
  if(broken.ok)throw new Error('Compiler accepted a disconnected loss stop')
  const account=await deploy('CircuitSmartAccount',[signer.address,engine.address])
  await send(collateral,'setBalance',[account.address,100_000_000n])
  await send(module,'useInterval',[manifest.series.intervalSec])
  let pool:Contract,market:Contract,marketId:Hex,expiry:bigint
  async function nextWindow(){
   pool=await deploy('MockBinaryPool',[collateral.address,outcome.address],'CircuitEngine.t')
   expiry=(await client.getBlock()).timestamp+BigInt(manifest.series.intervalSec)
   market=await deploy('MockBinaryMarket',[pool.address,collateral.address,outcome.address,expiry],'CircuitEngine.t')
   marketId=toHex(++sequence,{size:32});await send(module,'useMarket',[market.address])
  }
  await nextWindow()
  const start=manifest.action.sizing
  const created=start?await send(engine,'createConfiguredLadderStrategy',[manifestHash(manifest),config,account.address,marketId!,parseUnits(start.initialCollateral,6),parseUnits(start.incrementCollateral,6)]):await send(engine,'createConfiguredStrategy',[manifestHash(manifest),config,account.address,marketId!,true])
  const {strategyId}=parseEventLogs({abi:engine.abi,eventName:'StrategyCreated',logs:created.logs})[0].args as {strategyId:Hex}
  const readState=async()=>(await client.readContract({...engine,functionName:'getStrategy',args:[strategyId]}) as [unknown,Runtime])[1]
  await send(engine,'activateStrategy',[strategyId])
  const outcomes=template.id==='ladder'?['WIN','WIN','WIN']:template.id==='streak'?['WIN','LOSS']:['WIN','LOSS','LOSS']
  const rounds=[]
  for(let round=0;round<outcomes.length;round++){
   const before=await readState();if(before.manifestHash!==manifestHash(manifest))throw new Error('Authorized manifest mismatch')
   if(before.status!==2)throw new Error('Expected an armed round')
   const budget=before.nextOrderBudget
   const price=template.id==='ladder'?250_000n:750_000n
   const quantity=template.id==='ladder'?budget*4n:template.id==='streak'&&round===1?2_000_000n:4_000_000n
   const spent=quantity*(manifest.action.type==='BUY_DOWN'?1_000_000n-price:price)/1_000_000n
   await send(pool!,'configure',[spent,quantity,true])
   const triggerHash=await callback(pool!.address,[keccak256(stringToHex('OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)')),toHex(sequence,{size:32}),toHex(round+1,{size:32})],encodeAbiParameters(parseAbiParameters('uint256,uint256,uint256,uint256'),[1n,0n,0n,price]))
   if((await readState()).status!==3)throw new Error('Callback did not trigger the compiled program')
   const order=await send(engine,'executeReadyAction',[strategyId,price,quantity])
   const filled=await readState();if(filled.currentPositionSize!==quantity||filled.status!==5)throw new Error('Missing actual position accounting')
   const side=manifest.action.type==='BUY_UP'?0:1
   await send(market!,'setWinner',[outcomes[round]==='WIN'?side:1-side]);await send(market!,'setStatus',[4])
   const resolutionHash=await callback(market!.address,[keccak256(stringToHex('StatusChanged(uint8,uint8)')),toHex(1,{size:32}),toHex(4,{size:32})],'0x')
   const after=await readState()
   const resolutionReceipt=await client.getTransactionReceipt({hash:resolutionHash})
   const stops=parseEventLogs({abi:engine.abi,eventName:'StrategyStopped',logs:resolutionReceipt.logs.filter(log=>log.address.toLowerCase()===engine.address.toLowerCase())}).map(log=>log.args as {strategyId:Hex;reason:number})
   const isLastRound=round===outcomes.length-1
   const expectedStop=template.id==='ladder'?1:2 // MAX_ROUNDS / CONSECUTIVE_LOSSES
   if(isLastRound){
    if(stops.length!==1||stops[0].strategyId!==strategyId||stops[0].reason!==expectedStop)throw new Error('Program stopped for the wrong reason')
    if(expectedStop===1&&after.round!==config.maxRounds)throw new Error('Round limit was not reached')
    if(expectedStop===2&&after.consecutiveLosses!==config.stopAfterLosses)throw new Error('Loss limit was not reached')
   }else if(stops.length)throw new Error('Program emitted an early stop')
   const stopReason=isLastRound?(expectedStop===1?'MAX_ROUNDS':'CONSECUTIVE_LOSSES'):null
   if(after.currentPositionSize!==0n||after.cumulativeCapitalUsed>config.maxTotalCapitalAtRisk||after.round>config.maxRounds)throw new Error('Position settlement or bounds failed')
   if(after.cumulativeCapitalUsed!==before.cumulativeCapitalUsed+spent)throw new Error('Spend accounting mismatch')
   rounds.push({round:round+1,outcome:outcomes[round],orderBudget:formatUnits(budget,6),actualSpend:formatUnits(spent,6),cumulativeSpend:formatUnits(after.cumulativeCapitalUsed,6),nextBudget:after.status===6?formatUnits(after.nextOrderBudget,6):null,status:after.status,stopReason,triggerHash,orderHash:order.transactionHash,resolutionHash})
   if(round===outcomes.length-1){if(after.status!==8)throw new Error('Program did not stop at its own limit')}else{
    if(after.status!==6)throw new Error('Expected rollover')
    await rpc('evm_setNextBlockTimestamp',[Number(expiry!)]);await rpc('evm_mine',[]);await nextWindow()
    await send(engine,'bindMarket',[strategyId,marketId!,market!.address,pool!.address,collateral.address,outcome.address,manifest.action.type==='BUY_UP'?1n:2n])
   }
  }
  if(template.id==='ladder'&&rounds.map(r=>r.orderBudget).join(',')!=='5,7.5,10')throw new Error('Ladder did not follow its compiled sizing rule')
  if(template.id==='streak'&&rounds.map(r=>r.orderBudget).join(',')!=='3,2')throw new Error('Streak did not roll redeemed winnings')
  if(template.id==='contrarian'&&rounds.map(r=>r.orderBudget).join(',')!=='10,2,10')throw new Error('Contrarian did not apply distinct win/loss progression')
  results.push({program:template.name,engine:engine.address,strategyId,manifestHash:manifestHash(manifest),graph,manifest,dsl:compilation.program,rejectedDisconnectedLoss:broken.errors,rounds,finalState:await readState()})
 }
 if(new Set(results.map(r=>r.engine)).size!==1||new Set(results.map(r=>r.manifestHash)).size!==3)throw new Error('Shared engine or distinct program evidence failed')
 const evidence={scope:'LOCAL ANVIL + MOCK VENUE + IMPERSONATED VALIDATOR ONLY. Not live Shannon, live Reactivity subscription, real market liquidity or performance evidence.',verifiedAt:new Date().toISOString(),chainId:31337,engine:engine.address,engineCodeHash:keccak256((await client.getCode({address:engine.address}))!),engineDeployments:1,programsExecuted:results.length,settledRounds:results.reduce((sum,r)=>sum+r.rounds.length,0),results,transactions}
 await writeFile('deployments/evidence/local-three-programs.json',JSON.stringify(evidence,(_,value)=>typeof value==='bigint'?value.toString():value,2)+'\n')
 console.log(`PASS: ${results.length} graph-compiled programs, 1 Engine, ${evidence.settledRounds} settled rounds; distinct sizing/stop behavior and disconnected-loss rejection verified. LOCAL MOCK EVIDENCE ONLY.`)
} finally {server.kill('SIGTERM')}
