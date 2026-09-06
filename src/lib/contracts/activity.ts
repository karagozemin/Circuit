import { formatUnits } from 'viem'
/** Human explanations use only event values; no preview or inferred fill becomes an activity. */
export function describeStrategyEvent(name:string,args:Record<string,unknown>) {
  const units=(key:string)=>typeof args[key]==='bigint'?formatUnits(args[key],6):'—'
  switch(name){
    case 'TriggerMatched': return `A verified UP fill at ${units('fillPrice')} matched the approved trigger in round ${args.round}.`
    case 'OrderRequested': return `Requested an IOC capped at ${units('maxSpend')} tUSDC; any unfilled quantity will be cancelled.`
    case 'OrderExecuted': return `Spent ${units('collateralUsed')} tUSDC and received ${units('positionReceived')} outcome shares.`
    case 'OrderSkipped': return 'No position was filled; no loss is counted for this order.'
    case 'RoundResolved': return `Round ${args.round}: ${['win','loss','void','skipped'][Number(args.result)]??'resolved'}. Actual redeemed proceeds: ${units('realizedProceeds')} tUSDC.`
    case 'RolloverComputed': return `The approved policy sets the next order budget to ${units('nextOrderBudget')} tUSDC.`
    case 'MarketBound': return `Round ${args.round} is bound to its verified market and pool.`
    case 'StrategyPaused': return 'Owner paused execution, settlement and rollover. Existing positions remain owned by the smart account.'
    case 'StrategyResumed': return 'Owner resumed the prior on-chain state; already executed actions are not repeated.'
    case 'StrategyActivated': return 'The approved strategy is armed for verified market callbacks.'
    case 'ReactivityCallbackProcessed': return 'The Engine accepted an authenticated Reactivity callback.'
    case 'RiskLimitReached': case 'StrategyStopped': return 'The strategy stopped at an approved risk or round limit.'
    case 'StrategyCancelled': return 'Owner cancelled the strategy.'
    default: return 'Verified on-chain strategy update.'
  }
}
