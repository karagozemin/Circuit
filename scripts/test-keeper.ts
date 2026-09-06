/** Local integration only: real keeper process + Anvil transactions + deterministic venue mocks. */
import { spawn } from 'node:child_process'
import { mkdtemp,readFile,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createPublicClient,createWalletClient,http,encodeAbiParameters,parseAbiParameters,parseEventLogs,keccak256,stringToHex,type Abi,type Address,type Hex } from 'viem'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { initialManifest } from '../src/lib/strategy'
import { manifestHash,manifestToEngineConfig } from '../src/lib/contracts/engine'
const port=18545
const rpcUrl=`http://127.0.0.1:${port}`
const directory=await mkdtemp(`${tmpdir()}/circuit-keeper-`)
const server=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','50312','--silent'],{stdio:'ignore'})
const ownerKey=generatePrivateKey(), keeperKey=generatePrivateKey()
const owner=privateKeyToAccount(ownerKey), relayer=privateKeyToAccount(keeperKey)
const client=createPublicClient({chain:somniaShannon,transport:http(rpcUrl,{retryCount:0,timeout:2000})})
const wallet=createWalletClient({account:owner,chain:somniaShannon,transport:http(rpcUrl)})
async function rpc(method:string,params:unknown[]) {
 const response=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
 const value=await response.json();if(value.error)throw new Error(value.error.message);return value.result
}
async function artifact(source:string,name:string) {return JSON.parse(await readFile(`contracts/out/${source}/${name}.json`,'utf8')) as {abi:Abi;bytecode:{object:Hex}}}
async function deploy(source:string,name:string,args:unknown[]=[]) {
 const a=await artifact(source,name)
 const hash=await wallet.deployContract({abi:a.abi,bytecode:a.bytecode.object,args})
 const receipt=await client.waitForTransactionReceipt({hash})
 if(!receipt.contractAddress || receipt.status!=='success')throw new Error(`Deploy ${name} failed`)
 return {address:receipt.contractAddress,abi:a.abi}
}
async function send(contract:{address:Address;abi:Abi},functionName:string,args:unknown[]=[]) {
 const hash=await wallet.writeContract({...contract,functionName,args})
 const receipt=await client.waitForTransactionReceipt({hash})
 if(receipt.status!=='success')throw new Error(`${functionName} failed`)
 return receipt
}
const transcript:string[]=[]
try {
 let ready=false
 for(let i=0;i<40;i++){try{await client.getChainId();ready=true;break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
 if(!ready)throw new Error('Anvil did not start')
 for(const address of [owner.address,relayer.address])await rpc('anvil_setBalance',[address,'0x56bc75e2d63100000']) // 100 local-only test coins
 const collateral=await deploy('CircuitEngine.t.sol','MockCollateral')
 const outcome=await deploy('CircuitEngine.t.sol','MockOutcome')
 const pool=await deploy('CircuitEngine.t.sol','MockBinaryPool',[collateral.address,outcome.address])
 const market=await deploy('CircuitEngine.t.sol','MockBinaryMarket',[pool.address,collateral.address,outcome.address,(await client.getBlock()).timestamp+900n])
 const module=await deploy('CircuitEngine.t.sol','MockBinaryModule',[market.address,collateral.address,outcome.address])
 const engine=await deploy('CircuitEngine.sol','CircuitEngine',[owner.address,owner.address,module.address])
 const handler=await deploy('CircuitReactivityHandler.sol','CircuitReactivityHandler',[owner.address,engine.address])
 const account=await deploy('CircuitSmartAccount.sol','CircuitSmartAccount',[owner.address,engine.address])
 await send(engine,'setReactivityHandler',[handler.address])
 await send(collateral,'setBalance',[account.address,100_000_000n])
 const receipt=await send(engine,'createStrategy',[manifestHash(initialManifest),manifestToEngineConfig(initialManifest)])
 const created=parseEventLogs({abi:engine.abi,eventName:'StrategyCreated',logs:receipt.logs})[0].args as {strategyId:Hex}
 const id=created.strategyId
 const marketId=('0x'+'0'.repeat(63)+'1') as Hex
 await send(engine,'setExecutionAccount',[id,account.address])
 await send(engine,'bindMarket',[id,marketId,market.address,pool.address,collateral.address,outcome.address,2n])
 await send(engine,'activateStrategy',[id])
 // Anvil impersonation models validator dispatch. This is explicitly NOT live Reactivity evidence.
 const precompile='0x0000000000000000000000000000000000000100' as Address
 const precompileArtifact=JSON.parse(await readFile('contracts/out/MockReactivityPrecompile.sol/MockReactivityPrecompile.json','utf8'))
 await rpc('anvil_setCode',[precompile,precompileArtifact.deployedBytecode.object])
 await rpc('anvil_impersonateAccount',[precompile]);await rpc('anvil_setBalance',[precompile,'0x8ac7230489e80000'])
 const callbackWallet=createWalletClient({account:precompile,chain:somniaShannon,transport:http(rpcUrl)})
 const callback=await callbackWallet.writeContract({...handler,functionName:'onEvent',args:[pool.address,['0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399',marketId,marketId],encodeAbiParameters(parseAbiParameters('uint256,uint256,uint256,uint256'),[1n,0n,0n,750_000n])]})
 await client.waitForTransactionReceipt({hash:callback})
 async function runKeeper() {
  const child=spawn(process.execPath,['--import','tsx','scripts/keeper.ts','--once','--execute'],{env:{...process.env,CIRCUIT_OPERATOR_PRIVATE_KEY:keeperKey,CIRCUIT_ENGINE_ADDRESS:engine.address,CIRCUIT_HANDLER_ADDRESS:handler.address,CIRCUIT_STRATEGY_IDS:id,CIRCUIT_EVIDENCE_DIR:directory,VITE_SOMNIA_RPC_URL:rpcUrl,VITE_SOMNIA_FALLBACK_RPC_URL:rpcUrl,VITE_SOMNIA_DIAGNOSTIC_RPC_URL:rpcUrl},stdio:['ignore','pipe','pipe']})
  let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
  const code=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)})
  transcript.push(output)
  if(code!==0)throw new Error(`Keeper exited ${code}: ${output}`)
 }
 await runKeeper()
 let state=await client.readContract({...engine,functionName:'getStrategy',args:[id]}) as [unknown,{status:number;nextOrderBudget:bigint;cumulativeCapitalUsed:bigint}]
 if(state[1].status!==5 || state[1].cumulativeCapitalUsed!==2_500_000n)throw new Error('Actual keeper did not submit and account for the IOC')
 await send(market,'setStatus',[4])
 await runKeeper()
 state=await client.readContract({...engine,functionName:'getStrategy',args:[id]}) as typeof state
 if(state[1].status!==6 || state[1].nextOrderBudget!==5_000_000n)throw new Error('Actual keeper did not redeem and compute rollover')
 await runKeeper() // Separate non-owner relayer cannot grant approval or bind a successor.
 if (!transcript[transcript.length-1].includes('OWNER_BINDING_REQUIRED')) throw new Error('Keeper did not enforce owner-only rebinding')
 await send(engine,'setAutomaticRollover',[id,true])
 const nextPool=await deploy('CircuitEngine.t.sol','MockBinaryPool',[collateral.address,outcome.address])
 const expiry=await client.readContract({...market,functionName:'expiry'}) as bigint
 const nextMarket=await deploy('CircuitEngine.t.sol','MockBinaryMarket',[nextPool.address,collateral.address,outcome.address,expiry+900n])
 await send(module,'useMarket',[nextMarket.address])
 const nextId=('0x'+'0'.repeat(63)+'2') as Hex
 const addressTopic=(address:Address)=>('0x'+address.slice(2).padStart(64,'0')) as Hex
 const createdData=encodeAbiParameters(parseAbiParameters('uint256,uint256,address,string,uint256,uint64,uint64,uint256,string,uint64'),[1n,2n,collateral.address,'BTC',0n,expiry,expiry+900n,0n,'local next window',900n])
 const nextCallback=await callbackWallet.writeContract({...handler,functionName:'onEvent',args:[module.address,[keccak256(stringToHex('MarketCreated(bytes32,address,address,uint256,uint256,address,string,uint256,uint64,uint64,uint256,string,uint64)')),nextId,addressTopic(nextMarket.address),addressTopic(nextPool.address)],createdData]})
 await client.waitForTransactionReceipt({hash:nextCallback})
 await runKeeper()
 const rolled=await client.readContract({...engine,functionName:'getStrategy',args:[id]}) as [unknown,{status:number;round:number;currentMarketId:Hex}]
 if(rolled[1].status!==2 || rolled[1].round!==2 || rolled[1].currentMarketId!==nextId)throw new Error('Non-owner keeper did not automatically arm the verified successor')
 const allowance=await client.readContract({...collateral,functionName:'allowance',args:[account.address,nextPool.address]})
 if(allowance!==5_000_000n)throw new Error('Automatic approval exceeded computed rollover budget')
 await writeFile('deployments/evidence/local-keeper-integration.txt' ,'LOCAL ANVIL + MOCK VENUE ONLY. No live Reactivity or live market resolution claim.\n'+transcript.join('\n'))
 console.log('PASS: separate keeper signer executed IOC, restarted, redeemed, enforced owner consent, then automatically subscribed/approved/armed a verified successor with exact budget.')
} finally {server.kill('SIGTERM')}
