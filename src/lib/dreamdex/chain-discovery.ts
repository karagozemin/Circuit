import { defaultExpiryBuffer } from '../market-windows'
import { binaryModuleReadAbi } from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { createPublicClient, fallback, http, parseAbi, type Address } from 'viem'
import { DREAMDEX_CONTRACTS, SHANNON_RPC_URL, SHANNON_FALLBACK_RPC_URL, SHANNON_DIAGNOSTIC_RPC_URL } from './config'
import type { DiscoverMarketOptions, TradingMarketSnapshot } from './discovery'
import { MarketDiscoveryError } from './discovery-error'
const createdAbi = parseAbi(['event MarketCreated(bytes32 indexed marketId,address indexed market,address indexed pool,uint256 yesId,uint256 noId,address collateral,string asset,uint256 strike,uint64 tradingStart,uint64 expiry,uint256 oracleQuestionId,string question,uint64 intervalSec)'])
const readAbi = parseAbi(['function owner() view returns(address)','function status() view returns(uint8)','function expiry() view returns(uint64)','function outcomeToken() view returns(address)','function decimals() view returns(uint8)','function getBookLevels(bool,uint64) view returns((uint256 price,uint256 quantity)[])'])

/** Indexer outage backstop. Creator ownership and every market binding are checked against chain state. */
export async function discoverFromChain({asset='BTC',intervalSec=900,minSecondsToExpiry=defaultExpiryBuffer(intervalSec),afterExpiry=0}:DiscoverMarketOptions = {}):Promise<TradingMarketSnapshot> {
  const module = DREAMDEX_CONTRACTS.binaryModule
  const creator = DREAMDEX_CONTRACTS.marketCreator
  if (!module || !creator) throw new Error('No authoritative dreamDEX deployment configured.')
  const client = createPublicClient({chain:somniaShannon,transport:fallback([SHANNON_RPC_URL,SHANNON_FALLBACK_RPC_URL,SHANNON_DIAGNOSTIC_RPC_URL].map(url=>http(url,{timeout:10000,retryCount:0})))})
  const [head,trustedOwner] = await Promise.all([client.getBlock(),client.readContract({address:creator,abi:readAbi,functionName:'owner'})])
  const creatorOwners = new Map<Address,Address>()
  // Shannon limits eth_getLogs to 1,000 blocks. Search newest-first, with four independent ranges in flight.
  for (let offset=0;offset<40000;offset+=4000) {
    const batches = await Promise.all(Array.from({length:4},(_,i)=> {
      const end=head.number-BigInt(offset+i*1000)
      return client.getLogs({event:createdAbi[0],fromBlock:end>999n?end-999n:0n,toBlock:end,strict:true})
    }))
    const candidates=batches.flat().filter(log=>log.args.asset===asset && Number(log.args.intervalSec)===intervalSec && Number(log.args.expiry)>afterExpiry && log.args.expiry-head.timestamp>=BigInt(minSecondsToExpiry)).sort((a,b)=>Number(a.args.expiry-b.args.expiry))
    for (const log of candidates) {
      let owner=creatorOwners.get(log.address)
      if (!owner) { owner=await client.readContract({address:log.address,abi:readAbi,functionName:'owner'});creatorOwners.set(log.address,owner) }
      if (owner.toLowerCase()!==trustedOwner.toLowerCase()) continue
      const rec=await client.readContract({address:module,abi:binaryModuleReadAbi,functionName:'markets',args:[log.args.marketId]})
      if (rec[7].toLowerCase()!==log.address.toLowerCase() || rec[8].toLowerCase()!==log.args.market.toLowerCase() || rec[9].toLowerCase()!==log.args.pool.toLowerCase()) continue
      const [status,expiry,outcomeToken,decimals,bids,asks]=await Promise.all([
        client.readContract({address:rec[8],abi:readAbi,functionName:'status'}),
        client.readContract({address:rec[8],abi:readAbi,functionName:'expiry'}),
        client.readContract({address:rec[8],abi:readAbi,functionName:'outcomeToken'}),
        client.readContract({address:rec[3],abi:readAbi,functionName:'decimals'}),
        client.readContract({address:rec[9],abi:readAbi,functionName:'getBookLevels',args:[true,1n]}),
        client.readContract({address:rec[9],abi:readAbi,functionName:'getBookLevels',args:[false,1n]}),
      ])
      if (status!==1 || expiry-head.timestamp<BigInt(minSecondsToExpiry)) continue
      return {marketId:log.args.marketId,marketAddress:rec[8],pool:rec[9],asset,intervalSec,question:log.args.question,
        expiry:Number(expiry),secondsToExpiry:Number(expiry-head.timestamp),collateral:rec[3],collateralDecimals:decimals,
        outcomeToken,yesId:rec[10],noId:rec[11],yesSymbol:'',noSymbol:'',
        bestYesBid:bids[0]?Number(bids[0].price)/1e6:null,bestYesAsk:asks[0]?Number(asks[0].price)/1e6:null,
        indexedStatus:'unavailable — verified from chain logs',onchainStatus:status,blockNumber:head.number,blockTimestamp:Number(head.timestamp),sdkReady:false}
    }
  }
  throw new MarketDiscoveryError('unavailable', `No verified Trading ${asset} ${intervalSec/60}m window with at least ${minSecondsToExpiry}s remaining was found in recent on-chain creator events.`)
}
