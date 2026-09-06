import { keccak256, parseUnits, stringToHex } from 'viem'
import { canonicalManifest, validateManifest, type StrategyManifest } from '../strategy'

export const P0_PRICE_DECIMALS = 6
export const P0_COLLATERAL_DECIMALS = 6

export interface EngineStrategyConfig {
  assetId: number
  intervalSec: number
  triggerType: number
  triggerValue: bigint
  actionType: number
  maxOrderCollateral: bigint
  maxSlippageBps: number
  maxTotalCapitalAtRisk: bigint
  maxRounds: number
  stopAfterLosses: number
  minSecondsToExpiry: number
  rollPercentBps: number
}

export function manifestHash(manifest: StrategyManifest) {
  return keccak256(stringToHex(canonicalManifest(manifest)))
}

export function manifestToEngineConfig(manifest: StrategyManifest): EngineStrategyConfig {
  const issues = validateManifest(manifest)
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(" "))
  return {
    assetId: manifest.series.asset === 'BTC' ? 0 : 1,
    intervalSec: manifest.series.intervalSec,
    triggerType: manifest.trigger.type === 'LAST_FILL_PRICE_ABOVE' ? 0 : 1,
    triggerValue: parseUnits(manifest.trigger.value, P0_PRICE_DECIMALS),
    actionType: manifest.action.type === 'BUY_UP' ? 0 : 1,
    maxOrderCollateral: parseUnits(manifest.action.maxCollateral, P0_COLLATERAL_DECIMALS),
    maxSlippageBps: manifest.action.maxSlippageBps,
    maxTotalCapitalAtRisk: parseUnits(manifest.policy.maxTotalCapitalAtRisk, P0_COLLATERAL_DECIMALS),
    maxRounds: manifest.policy.maxRounds,
    stopAfterLosses: manifest.policy.stopAfterConsecutiveLosses,
    minSecondsToExpiry: manifest.policy.minSecondsToExpiry,
    rollPercentBps: manifest.resolution.onWin.rollPercent * 100,
  }
}

const strategyConfigComponents = [
  { name: 'assetId', type: 'uint8' },
  { name: 'intervalSec', type: 'uint32' },
  { name: 'triggerType', type: 'uint8' },
  { name: 'triggerValue', type: 'uint256' },
  { name: 'actionType', type: 'uint8' },
  { name: 'maxOrderCollateral', type: 'uint256' },
  { name: 'maxSlippageBps', type: 'uint16' },
  { name: 'maxTotalCapitalAtRisk', type: 'uint256' },
  { name: 'maxRounds', type: 'uint16' },
  { name: 'stopAfterLosses', type: 'uint16' },
  { name: 'minSecondsToExpiry', type: 'uint32' },
  { name: 'rollPercentBps', type: 'uint16' },
] as const

export const circuitEngineAbi = [
  { type: 'function', name: 'activationSetupVersion', stateMutability: 'pure', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'createConfiguredStrategy', stateMutability: 'nonpayable', inputs: [
    { name: 'manifestHash', type: 'bytes32' },
    { name: 'config', type: 'tuple', components: strategyConfigComponents },
    { name: 'executionAccount', type: 'address' },
    { name: 'marketId', type: 'bytes32' },
    { name: 'enableRollover', type: 'bool' },
  ], outputs: [{ name: 'strategyId', type: 'bytes32' }] },
  { type: 'function', name: 'setAutomaticRollover', stateMutability: 'nonpayable', inputs: [{name:'strategyId',type:'bytes32'},{name:'enabled',type:'bool'}],outputs:[] },
  {
    type: 'event',
    name: 'StrategyCreated',
    inputs: [
      { name: 'strategyId', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'manifestHash', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'MarketBound',
    inputs: [
      { name: 'strategyId', type: 'bytes32', indexed: true },
      { name: 'marketId', type: 'bytes32', indexed: true },
      { name: 'pool', type: 'address', indexed: true },
      { name: 'round', type: 'uint16', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'StrategyActivated',
    inputs: [
      { name: 'strategyId', type: 'bytes32', indexed: true },
      { name: 'marketId', type: 'bytes32', indexed: true },
      { name: 'pool', type: 'address', indexed: true },
    ],
  },
  { type: 'function', name: 'reactivityHandler', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'setExecutionAccount', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [] },
  {
    type: 'function',
    name: 'createStrategy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'manifestHash', type: 'bytes32' },
      {
        name: 'config',
        type: 'tuple',
        components: strategyConfigComponents,
      },
    ],
    outputs: [{ name: 'strategyId', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'bindMarket',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'strategyId', type: 'bytes32' },
      { name: 'marketId', type: 'bytes32' },
      { name: 'market', type: 'address' },
      { name: 'pool', type: 'address' },
      { name: 'collateral', type: 'address' },
      { name: 'outcomeToken', type: 'address' },
      { name: 'outcomeTokenId', type: 'uint256' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'activateStrategy', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'pauseStrategy', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'resumeStrategy', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'cancelStrategy', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }], outputs: [] },
] as const
