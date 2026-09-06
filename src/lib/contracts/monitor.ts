import { SDK } from '@somnia-chain/reactivity'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, fallback, http, type Hex, type Address } from 'viem'
import { SHANNON_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_DIAGNOSTIC_RPC_URL } from '../dreamdex/config'
import { lifecycleAbi } from './lifecycle-abi'
import { REACTIVITY_MIN_BALANCE } from './activation'
const client = createPublicClient({chain:somniaShannon,transport:fallback([SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL].map(url=>http(url,{timeout:10000,retryCount:0})))})
export async function readStrategyState(engine:Address, id:Hex) {
  const [config,runtime] = await client.readContract({address:engine,abi:lifecycleAbi,functionName:'getStrategy',args:[id]})
  return {config,runtime,blockNumber:await client.getBlockNumber()}
}
export async function readStrategyEvents(engine:Address,id:Hex,fromBlock:bigint,toBlock:bigint) {
  const events = []
  for (let start = fromBlock; start <= toBlock; start += 1000n) {
    const end = start + 999n < toBlock ? start + 999n : toBlock
    const logs = await client.getContractEvents({address:engine,abi:lifecycleAbi,fromBlock:start,toBlock:end,strict:true})
    events.push(...logs.filter(log => 'strategyId' in log.args && log.args.strategyId === id))
  }
  return events
}
export async function readAutomationHealth(subscriptionId:bigint, handler:Address) {
  const info = await new SDK({public:client}).getSubscriptionInfo(subscriptionId)
  if (info instanceof Error) return {healthy:false,detail:`Subscription #${subscriptionId} unavailable.`}
  const balance = await client.getBalance({address:info.owner})
  const healthy = info.subscriptionData.handlerContractAddress.toLowerCase() === handler.toLowerCase() && balance >= REACTIVITY_MIN_BALANCE
  return {healthy,detail:healthy ? `Subscription #${subscriptionId} funded.` : `AUTOMATION_PAUSED · subscription #${subscriptionId} inactive or underfunded. Sync remains available.`}
}
