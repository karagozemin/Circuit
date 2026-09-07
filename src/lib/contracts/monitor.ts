import { normalizeSubscriptionInfo } from './subscription-info'
import { SDK } from '@somnia-chain/reactivity'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, createWalletClient, custom, fallback, http, parseAbi, type Hex, type Address } from 'viem'
import type { InjectedProvider } from '../wallet'
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
  const info = normalizeSubscriptionInfo(await new SDK({public:client}).getSubscriptionInfo(subscriptionId))
  const balance = await client.getBalance({address:info.owner})
  const healthy = info.subscriptionData.handlerContractAddress.toLowerCase() === handler.toLowerCase() && balance >= REACTIVITY_MIN_BALANCE
  return {healthy,emitter:info.subscriptionData.emitter,detail:healthy ? `Subscription #${subscriptionId} funded.` : `AUTOMATION_PAUSED · subscription #${subscriptionId} inactive or underfunded. Sync remains available.`}
}

export async function readExecutionHealth(runtime:{status:number;collateral:Address;executionAccount:Address;currentPool:Address;nextOrderBudget:bigint}) {
  if(runtime.status===7)return 'Strategy paused; execution and rollover are disabled.'
  if(![2,3].includes(runtime.status))return ''
  const abi=parseAbi(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'])
  const [balance,allowance]=await Promise.all([
    client.readContract({address:runtime.collateral,abi,functionName:'balanceOf',args:[runtime.executionAccount]}),
    client.readContract({address:runtime.collateral,abi,functionName:'allowance',args:[runtime.executionAccount,runtime.currentPool]}),
  ])
  if(allowance<runtime.nextOrderBudget)return 'EXECUTION BLOCKED · current pool allowance is revoked or below the next-round budget.'
  if(balance<runtime.nextOrderBudget)return 'EXECUTION BLOCKED · fund the smart account for its approved next-round budget.'
  return 'Current pool allowance and smart-account funding verified.'
}

export async function syncStrategyTransaction(provider:InjectedProvider,account:Address,engine:Address,id:Hex) {
  const {runtime}=await readStrategyState(engine,id)
  const simulation=await client.simulateContract({address:engine,abi:lifecycleAbi,functionName:'syncStrategy',args:[id,runtime.currentMarketId],account})
  if(!simulation.result)return
  const wallet=createWalletClient({account,chain:somniaShannon,transport:custom(provider)})
  const hash=await wallet.writeContract(simulation.request)
  const receipt=await client.waitForTransactionReceipt({hash})
  if(receipt.status!=='success')throw new Error(`Sync reverted: ${hash}`)
  return {hash,blockNumber:receipt.blockNumber}
}
