import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { SDK, SomniaReactivityPrecompileABI } from '@somnia-chain/reactivity'
import { binaryModuleReadAbi } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, fallback, http, isAddress, parseAbi, parseGwei, webSocket, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import artifact from '../contracts/out/CircuitEngine.sol/CircuitEngine.json'
import { requirePrivateKey } from './private-key'
import { planReadyOrder, type OrderBounds, type OrderGrid } from '../src/lib/automation/order-plan'
import { discoverTradingMarket } from '../src/lib/dreamdex/discovery'
import { SHANNON_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_DIAGNOSTIC_RPC_URL, SHANNON_WS_RPC_URL } from '../src/lib/dreamdex/config'

const abi = artifact.abi as Abi
const account = privateKeyToAccount(requirePrivateKey(process.env.CIRCUIT_OPERATOR_PRIVATE_KEY))
const engine = process.env.CIRCUIT_ENGINE_ADDRESS ?? process.env.VITE_CIRCUIT_ENGINE_ADDRESS
const handler = process.env.CIRCUIT_HANDLER_ADDRESS ?? process.env.VITE_CIRCUIT_HANDLER_ADDRESS
if (!engine || !isAddress(engine) || !handler || !isAddress(handler)) throw new Error('Configure Engine and handler addresses.')
const engineAddress: Address = engine
const handlerAddress: Address = handler
const strategyIds = (process.env.CIRCUIT_STRATEGY_IDS ?? '').split(',').filter(Boolean) as Hex[]
if (!strategyIds.length || strategyIds.some(id => !/^0x[\da-f]{64}$/i.test(id))) throw new Error('CIRCUIT_STRATEGY_IDS must list approved on-chain strategy IDs.')
const ownerRollover = process.argv.includes('--owner-rollover')
const once = process.argv.includes('--once')
const execute = process.argv.includes('--execute')
const evidenceDir = process.env.CIRCUIT_EVIDENCE_DIR ?? 'deployments/evidence'
await mkdir(evidenceDir, {recursive:true})
const transport = fallback([SHANNON_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_DIAGNOSTIC_RPC_URL].map(url => http(url,{timeout:10000,retryCount:0})))
const client = createPublicClient({chain:somniaShannon,transport})
const wallet = createWalletClient({account,chain:somniaShannon,transport})
if (await client.getChainId() !== 50312) throw new Error('Keeper is restricted to Shannon testnet.')
const wiredHandler = await client.readContract({address:engineAddress,abi,functionName:'reactivityHandler'}) as Address
if (wiredHandler.toLowerCase() !== handlerAddress.toLowerCase()) throw new Error('Engine/handler mismatch.')
const sdk = new SDK({public:client,wallet})
const stringify = (value: unknown) => JSON.stringify(value, (_,v) => typeof v === 'bigint' ? v.toString() : v)
async function record(kind: string, data: unknown) {
  const line = stringify({at:new Date().toISOString(),kind,data})
  console.log(line)
  await appendFile(`${evidenceDir}/keeper.jsonl`,line+'\n')
}
const poolAbi = parseAbi(['function getOrderBookParameters() view returns ((uint256 tickSize,uint256 minQuantity,uint256 lotSize))'])
const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)'])
const accountAbi = parseAbi(['function execute(address,uint256,bytes) returns (bytes)'])
interface Runtime { owner:Address; status:number; round:number; currentMarketId:Hex; currentMarket:Address; currentPool:Address; collateral:Address; executionAccount:Address; currentPositionSize:bigint; nextOrderBudget:bigint; triggerFillPrice:bigint; cumulativeCapitalUsed:bigint }
interface Config extends Omit<OrderBounds,'triggerFillPrice'|'nextOrderBudget'|'cumulativeCapitalUsed'> { assetId:number; intervalSec:900|3600; minSecondsToExpiry:number }
async function send(address:Address, callAbi:Abi, functionName:string, args:readonly unknown[], reason:string) {
  const simulation = await client.simulateContract({address,abi:callAbi,functionName,args,account})
  if (!execute) { await record('dry-run',{reason,address,functionName,args}); return }
  const hash = await wallet.writeContract(simulation.request)
  await record('submitted',{reason,hash})
  const receipt = await client.waitForTransactionReceipt({hash,timeout:120000})
  await record('receipt',{reason,hash,status:receipt.status,blockNumber:receipt.blockNumber,logs:receipt.logs})
  if (receipt.status !== 'success') throw new Error(`${reason} reverted: ${hash}`)
  return receipt
}
// Persist each subscription immediately. A restart never creates an unbounded stream of duplicates.
const subscriptionFile = `${evidenceDir}/subscriptions-${engineAddress.toLowerCase()}.json`
let subscriptions: Record<string,{id:string;hash:Hex}> = {}
try { subscriptions = JSON.parse(await readFile(subscriptionFile,'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
async function subscribe(emitter:Address, topic:Hex) {
  const key = `${emitter.toLowerCase()}:${topic}`
  const saved = subscriptions[key]
  if (saved) {
    const info = await sdk.getSubscriptionInfo(BigInt(saved.id))
    if (!(info instanceof Error) && info.subscriptionData.handlerContractAddress.toLowerCase() === handlerAddress.toLowerCase()) return
    throw new Error(`Subscription ${saved.id} unavailable; inspect before replacing it.`)
  }
  if (!execute) { await record('dry-run-subscription',{emitter,topic}); return }
  const hash = await sdk.subscribe({handlerContractAddress:handlerAddress,filter:{emitter,eventTopics:[topic]},options:{priorityFeePerGas:parseGwei('2'),maxFeePerGas:parseGwei('20'),gasLimit:10000000n}})
  if (hash instanceof Error) throw hash
  await record('subscription-submitted',{hash,emitter,topic})
  const receipt = await client.waitForTransactionReceipt({hash})
  if (receipt.status !== 'success') throw new Error(`Subscription reverted: ${hash}`)
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({abi:SomniaReactivityPrecompileABI,data:log.data,topics:log.topics})
      if (event.eventName === 'SubscriptionCreated') {
        subscriptions[key] = {id:event.args.subscriptionId.toString(),hash}
        await writeFile(subscriptionFile, JSON.stringify(subscriptions,null,2)+'\n')
        await record('subscription',{emitter,topic,hash,id:event.args.subscriptionId,blockNumber:receipt.blockNumber})
        return
      }
    } catch (error) { if (error instanceof Error && !error.name.includes('Abi') && !error.name.includes('Decode')) throw error }
  }
  throw new Error('No subscription ID in successful receipt.')
}
const fillTopic = '0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399' as Hex
const { keccak256, stringToHex } = await import('viem')
const statusTopic = keccak256(stringToHex('StatusChanged(uint8,uint8)'))
const createdTopic = keccak256(stringToHex('MarketCreated(bytes32,address,address,uint256,uint256,address,string,uint256,uint64,uint64,uint256,string,uint64)'))
const successorEvents = parseAbi(['event SuccessorMarketRegistered(bytes32 indexed marketId,address indexed creator,uint8 assetId,uint32 intervalSec)'])
async function step(id:Hex) {
  const [config,runtime] = await client.readContract({address:engineAddress,abi,functionName:'getStrategy',args:[id]}) as [Config,Runtime]
  await record('state',{id,config,runtime})
  if ([0,1,7,8,9].includes(runtime.status)) return
  const balance = await client.getBalance({address:account.address})
  if (balance < 32n * 10n**18n) await record('AUTOMATION_PAUSED',{id,reason:'Subscription owner has less than 32 STT. Sync backstop remains available.'})
  else {
    try {
      await subscribe(runtime.currentPool,fillTopic)
      await subscribe(runtime.currentMarket,statusTopic)
      const creator = await client.readContract({address:engineAddress,abi,functionName:'seriesCreators',args:[id]}) as Address
      await subscribe(creator,createdTopic)
    } catch (error) { await record('AUTOMATION_PAUSED',{id,reason:error instanceof Error ? error.message:String(error)}) }
  }
  if ([2,3,5].includes(runtime.status)) {
    const simulation = await client.simulateContract({address:engineAddress,abi,functionName:'syncStrategy',args:[id,runtime.currentMarketId],account})
    if (simulation.result === true) {
      await send(engineAddress,abi,'syncStrategy',[id,runtime.currentMarketId],'settlement/expiry backstop')
      return
    }
  }
  if (runtime.status === 3) {
    const grid = await client.readContract({address:runtime.currentPool,abi:poolAbi,functionName:'getOrderBookParameters'}) as OrderGrid
    const plan = planReadyOrder({...config,...runtime},grid)
    await send(engineAddress,abi,'executeReadyAction',[id,plan.yesLimitPrice,plan.quantity],'bounded IOC from verified trigger')
  } else if (runtime.status === 6) {
    const automatic = await client.readContract({address:engineAddress,abi,functionName:'automaticRollover',args:[id]})
    if (automatic === true) {
      const creator = await client.readContract({address:engineAddress,abi,functionName:'seriesCreators',args:[id]}) as Address
      const module = await client.readContract({address:engineAddress,abi,functionName:'binaryModule'}) as Address
      let end = await client.getBlockNumber()
      for (let scanned = 0; scanned < 40000; scanned += 1000) {
        const start = end > 999n ? end - 999n : 0n
        const candidates = await client.getLogs({address:handlerAddress,event:successorEvents[0],args:{creator},fromBlock:start,toBlock:end,strict:true})
        for (const event of candidates.reverse()) {
          if (event.args.assetId !== config.assetId || event.args.intervalSec !== config.intervalSec || event.args.marketId === runtime.currentMarketId) continue
          const nextId = event.args.marketId
          const record = await client.readContract({address:module,abi:binaryModuleReadAbi,functionName:'markets',args:[nextId]})
          try { await client.simulateContract({address:engineAddress,abi,functionName:'rollToNextMarket',args:[id,nextId],account}) }
          catch { continue } // Stale/locked candidates are never forced into the strategy.
          await subscribe(record[9],fillTopic)
          await subscribe(record[8],statusTopic)
          await send(engineAddress,abi,'rollToNextMarket',[id,nextId],'permissionless verified successor and bounded pool approval')
          return
        }
        if (start === 0n) break
        end = start - 1n
      }
      await record('WAITING_SUCCESSOR',{id,reason:'No eligible successor authenticated by a creator callback yet.'})
      return
    }
    if (!ownerRollover || runtime.owner.toLowerCase() !== account.address.toLowerCase()) {
      await record('OWNER_BINDING_REQUIRED',{id,reason:'Successor binding requires the strategy owner. Use the explicit owner-run demo mode or submit owner-signed binding.'}); return
    }
    const expiry = await client.readContract({address:runtime.currentMarket,abi:parseAbi(['function expiry() view returns (uint64)']),functionName:'expiry'})
    const next = await discoverTradingMarket({asset:config.assetId === 0 ? 'BTC':'ETH',intervalSec:config.intervalSec,minSecondsToExpiry:config.minSecondsToExpiry,afterExpiry:Number(expiry)})
    if (next.collateral.toLowerCase() !== runtime.collateral.toLowerCase()) throw new Error('Successor changed collateral.')
    const funds = await client.readContract({address:next.collateral,abi:tokenAbi,functionName:'balanceOf',args:[runtime.executionAccount]})
    if (funds < runtime.nextOrderBudget) throw new Error('Smart account needs owner funding for successor budget.')
    // Owner authorizes exactly this new pool and budget. Ordinary keepers cannot grant approvals.
    const allowance = await client.readContract({address:next.collateral,abi:tokenAbi,functionName:'allowance',args:[runtime.executionAccount,next.pool]})
    if (allowance < runtime.nextOrderBudget) await send(runtime.executionAccount,accountAbi,'execute',[next.collateral,0n,encodeFunctionData({abi:tokenAbi,functionName:'approve',args:[next.pool,runtime.nextOrderBudget]})],'owner successor pool approval')
    await subscribe(next.pool,fillTopic)
    await subscribe(next.marketAddress,statusTopic)
    await send(engineAddress,abi,'bindMarket',[id,next.marketId,next.marketAddress,next.pool,next.collateral,next.outcomeToken,config.actionType===0?next.yesId:next.noId],'owner binds authoritative successor')
  }
}
let busy = false
async function tick() {
  if (busy) return
  busy = true
  try { for (const id of strategyIds) { try { await step(id) } catch (error) { await record('error',{id,message:error instanceof Error ? error.message:String(error)}) } } }
  finally { busy = false }
}
await tick()
if (!once) {
  // Engine events wake execution immediately. Periodic reconciliation is only a liveness backstop.
  const ws = createPublicClient({chain:somniaShannon,transport:webSocket(SHANNON_WS_RPC_URL)})
  const unwatch = ws.watchContractEvent({address:[engineAddress,handlerAddress],abi:[...abi,...successorEvents],onLogs:logs => { void record('engine-events',logs).then(tick) },onError:error => { void record('websocket-degraded',{message:error.message}) }})
  const timer = setInterval(() => { void tick() },30000)
  for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,() => {clearInterval(timer);unwatch();process.exit(0)})
} else process.exit(0)
