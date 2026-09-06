import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { LIVE_SESSION_KEY, parseLiveSession, type LiveSession } from '../lib/contracts/live-session'
import { manifestHash } from '../lib/contracts/engine'
import { describeStrategyEvent } from '../lib/contracts/activity'
import { readWallet, SHANNON_CHAIN_ID, switchToShannon, WALLET_AUTOCONNECT_KEY, walletErrorMessage, type WalletSnapshot } from '../lib/wallet'
import type { TradingMarketSnapshot } from '../lib/dreamdex/discovery'
import type { StrategyManifest } from '../lib/strategy'
import { MarketDiscoveryError } from '../lib/dreamdex/discovery-error'

export interface ActivityEntry {id:string;at:string;title:string;detail:string;kind:'system'|'trade'|'reactivity'|'success'|'error';hash?:Hex}
export interface Runtime {owner:Address;manifestHash:Hex;status:number;round:number;currentMarketId:Hex;currentMarket:Address;currentPool:Address;collateral:Address;executionAccount:Address;currentPositionSize:bigint;nextOrderBudget:bigint;cumulativeCapitalUsed:bigint;consecutiveLosses:number}
export type Notice={id:number;message:string;tone:'success'|'error'|'info'}
export function useCircuit(){
 const [wallet,setWallet]=useState<WalletSnapshot>()
 const [walletBusy,setWalletBusy]=useState(false)
 const [session,setSession]=useState<LiveSession>()
 const [runtime,setRuntime]=useState<Runtime>()
 const [recovering,setRecovering]=useState(true)
 const [monitoring,setMonitoring]=useState(false)
 const [verifiedAt,setVerifiedAt]=useState<string>()
 const [block,setBlock]=useState<bigint>()
 const [health,setHealth]=useState('')
 const [activity,setActivity]=useState<ActivityEntry[]>([])
 const [notice,setNotice]=useState<Notice>()
 const [operation,setOperation]=useState<string>()
 const [tx,setTx]=useState<{phase:string;hash?:Hex}>()
 const [refreshKey,setRefreshKey]=useState(0)
 const controlLock=useRef(false)
 const toast=useCallback((message:string,tone:Notice['tone']='info')=>setNotice({id:Date.now(),message,tone}),[])
 const addActivity=useCallback((title:string,detail:string,kind:ActivityEntry['kind']='system',hash?:Hex)=>setActivity(items=>[{id:crypto.randomUUID(),at:new Date().toISOString(),title,detail,kind,hash},...items].slice(0,200)),[])
 const walletConnected=!!wallet && wallet.chainId===SHANNON_CHAIN_ID
 const ownerConnected=walletConnected && !!session && wallet!.address.toLowerCase()===session.owner.toLowerCase()
 useEffect(()=>{let disposed=false;void import('../lib/contracts/activation').then(actions=>{
   if(disposed)return;const unsubscribe=actions.observeTransactions(update=>setTx(update));cleanup=unsubscribe
 });let cleanup=()=>{};return()=>{disposed=true;cleanup()}},[])
 useEffect(()=>{const provider=window.ethereum;if(!provider)return
  const refresh=()=>{if(localStorage.getItem(WALLET_AUTOCONNECT_KEY)!=='true')return;void readWallet(provider).then(value=>setWallet(value??undefined)).catch(error=>toast(walletErrorMessage(error),'error'))}
  const disconnect=()=>{setWallet(undefined);localStorage.removeItem(WALLET_AUTOCONNECT_KEY)}
  refresh();provider.on?.('accountsChanged',refresh);provider.on?.('chainChanged',refresh);provider.on?.('disconnect',disconnect)
  return()=>{provider.removeListener?.('accountsChanged',refresh);provider.removeListener?.('chainChanged',refresh);provider.removeListener?.('disconnect',disconnect)}
 },[toast])
 useEffect(()=>{let disposed=false;void(async()=>{
  const saved=parseLiveSession(localStorage.getItem(LIVE_SESSION_KEY));if(!saved)return
  const [{configuredDeployment},{readStrategyState}]=await Promise.all([import('../lib/contracts/activation'),import('../lib/contracts/monitor')]);const deployment=configuredDeployment()
  if(!deployment || deployment.engine.toLowerCase()!==saved.engine.toLowerCase())throw new Error('The saved strategy belongs to a different deployment.')
  const state=await readStrategyState(deployment.engine,saved.strategyId)
  if(state.runtime.owner.toLowerCase()!==saved.owner.toLowerCase() || state.runtime.manifestHash!==manifestHash(saved.manifest))throw new Error('Saved strategy could not be verified against the chain.')
  if(!disposed){setSession(saved);setRuntime(state.runtime);setBlock(state.blockNumber);setVerifiedAt(new Date().toISOString())}
 })().catch(error=>{if(!disposed)toast(walletErrorMessage(error),'error')}).finally(()=>{if(!disposed)setRecovering(false)});return()=>{disposed=true}},[toast])
 useEffect(()=>{if(!session)return;let disposed=false;let reading=false;let cursor=BigInt(session.fromBlock)
  const refresh=async()=>{if(reading)return;reading=true;setMonitoring(true)
   try{const m=await import('../lib/contracts/monitor');const state=await m.readStrategyState(session.engine,session.strategyId);if(disposed)return
    setRuntime(state.runtime);setBlock(state.blockNumber);setVerifiedAt(new Date().toISOString())
    if(state.blockNumber>40000n && cursor<state.blockNumber-40000n)cursor=state.blockNumber-40000n
    const events=await m.readStrategyEvents(session.engine,session.strategyId,cursor,state.blockNumber);if(disposed)return
    setActivity(previous=>{const ids=new Set(previous.map(item=>item.id));const next=events.filter(e=>!ids.has(`${e.transactionHash}:${e.logIndex}`)).map(e=>({id:`${e.transactionHash}:${e.logIndex}`,at:new Date().toISOString(),title:e.eventName.replace(/([a-z])([A-Z])/g,'$1 $2'),detail:describeStrategyEvent(e.eventName,e.args),kind:(e.eventName==='OrderExecuted'?'trade':e.eventName==='TriggerMatched'?'reactivity':'success') as ActivityEntry['kind'],hash:e.transactionHash}));return [...next.reverse(),...previous].slice(0,200)})
    cursor=state.blockNumber+1n
    const [subscriptions,execution]=await Promise.all([Promise.all(session.subscriptions.map(id=>m.readAutomationHealth(BigInt(id),configuredHandler))),m.readExecutionHealth(state.runtime)])
    if(!disposed)setHealth([...subscriptions.filter(s=>!s.healthy).map(s=>s.detail),execution].filter(Boolean).join(' ') || 'Saved activation subscriptions are funded. Keeper availability is monitored separately.')
   }catch(error){if(!disposed)setHealth(`Connection needs attention. ${walletErrorMessage(error)}`)}finally{reading=false;if(!disposed)setMonitoring(false)}
  }
  let configuredHandler:Address
  void import('../lib/contracts/activation').then(({configuredDeployment})=>{const d=configuredDeployment();if(d&&!disposed){configuredHandler=d.handler;void refresh()}})
  const timer=window.setInterval(()=>{if(configuredHandler)void refresh()},10000)
  return()=>{disposed=true;clearInterval(timer)}
 },[session,refreshKey])
 const connect=async()=>{if(walletBusy)return;const provider=window.ethereum;if(!provider){toast('Install an Ethereum-compatible browser wallet, then connect it to Circuit.','error');return}setWalletBusy(true)
  try{const next=await readWallet(provider,true);if(!next)throw new Error('No wallet account was returned.');setWallet(next);localStorage.setItem(WALLET_AUTOCONNECT_KEY,'true');toast(next.chainId===SHANNON_CHAIN_ID?'Wallet connected. You are in control.':'Wallet connected. Switch to Shannon to transact.',next.chainId===SHANNON_CHAIN_ID?'success':'info');addActivity('Wallet connected','Read-only connection. No transaction was sent.','system')}
  catch(error){toast(walletErrorMessage(error),'error')}finally{setWalletBusy(false)}}
 const switchNetwork=async()=>{const provider=window.ethereum;if(!provider)return;setWalletBusy(true);try{await switchToShannon(provider);setWallet((await readWallet(provider))??undefined);toast('Network updated.','success')}catch(error){toast(walletErrorMessage(error),'error')}finally{setWalletBusy(false)}}
 const disconnect=()=>{setWallet(undefined);localStorage.removeItem(WALLET_AUTOCONNECT_KEY);toast('Disconnected from this browser. Your on-chain strategy is unchanged.')}
 const control=async(action:'pauseStrategy'|'resumeStrategy'|'sync')=>{if(controlLock.current)return;if(!window.ethereum||!walletConnected||!session){toast('Connect a wallet on Shannon to continue.','error');return}if(action!=='sync'&&!ownerConnected){toast('Connect the strategy owner wallet for this action.','error');return}
  controlLock.current=true;setOperation(action==='sync'?'Checking settlement':action==='pauseStrategy'?'Pausing strategy':'Resuming strategy');setTx(undefined)
  try{let result;if(action==='sync'){const {syncStrategyTransaction}=await import('../lib/contracts/monitor');result=await syncStrategyTransaction(window.ethereum,wallet!.address,session.engine,session.strategyId)}else{const a=await import('../lib/contracts/activation');const d=a.configuredDeployment();if(!d)throw new Error('Deployment is not configured.');result=await a.strategyTransaction(window.ethereum,wallet!.address,d,action,session.strategyId)}
   toast(result?'Transaction confirmed. Refreshing the on-chain state.':'No new settlement or expiry transition is available.',result?'success':'info');if(result)addActivity(action==='sync'?'State synchronized':action==='pauseStrategy'?'Strategy paused':'Strategy resumed',`Confirmed at block ${result.blockNumber}.`,'success',result.hash);setRefreshKey(k=>k+1)
  }catch(error){toast(walletErrorMessage(error),'error')}finally{controlLock.current=false;setOperation(undefined);setTx(undefined)}}
 const activated=async(id:Hex,subscriptions:bigint[],fromBlock:bigint,manifest:StrategyManifest)=>{const {configuredDeployment}=await import('../lib/contracts/activation');const d=configuredDeployment();if(!d||!wallet)throw new Error('Wallet or deployment disappeared.');const saved:LiveSession={chainId:50312,engine:d.engine,owner:wallet.address,strategyId:id,manifest,subscriptions:subscriptions.map(String),fromBlock:String(fromBlock)};setSession(saved);try{localStorage.setItem(LIVE_SESSION_KEY,JSON.stringify(saved))}catch{toast('Activated on chain. Browser recovery could not be saved; keep your strategy ID.','error')}setRefreshKey(k=>k+1)}
 return {wallet,walletBusy,walletConnected,ownerConnected,connect,switchNetwork,disconnect,session,runtime,recovering,monitoring,verifiedAt,block,health,activity,addActivity,notice,toast,dismissNotice:()=>setNotice(undefined),operation,tx,control,activated,refresh:()=>setRefreshKey(k=>k+1)}
}
export type Circuit=ReturnType<typeof useCircuit>

export function useMarket(manifest:StrategyManifest,enabled=true){
 const [state,setState]=useState<{status:'idle'|'loading'|'ready'|'error';market?:TradingMarketSnapshot;error?:string;errorKind?:'unavailable'|'connection';checkedAt?:string}>({status:'idle'})
 const [revision,setRevision]=useState(0)
 useEffect(()=>{if(!enabled)return;let disposed=false;setState({status:'loading'});void import('../lib/dreamdex/discovery').then(({discoverTradingMarket})=>discoverTradingMarket({asset:manifest.series.asset,intervalSec:manifest.series.intervalSec,minSecondsToExpiry:manifest.policy.minSecondsToExpiry})).then(market=>{if(!disposed)setState({status:'ready',market,checkedAt:new Date().toISOString()})}).catch(error=>{if(!disposed)setState({status:'error',error:walletErrorMessage(error),errorKind:error instanceof MarketDiscoveryError?error.kind:'connection'})});return()=>{disposed=true}},[enabled,manifest.series.asset,manifest.series.intervalSec,manifest.policy.minSecondsToExpiry,revision])
 return {...state,retry:()=>setRevision(v=>v+1)}
}
