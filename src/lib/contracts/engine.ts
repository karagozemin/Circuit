import { keccak256, parseUnits, stringToHex } from 'viem'
import { canonicalManifest, type StrategyManifest } from '../strategy'

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

export const circuitEngineAbi = [
  {
    type: 'function',
    name: 'createStrategy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'manifestHash', type: 'bytes32' },
      {
        name: 'config',
        type: 'tuple',
        components: [
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
        ],
      },
    ],
    outputs: [{ name: 'strategyId', type: 'bytes32' }],
  },
  { type: 'function', name: 'activateStrategy', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'pauseStrategy', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'resumeStrategy', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'cancelStrategy', stateMutability: 'nonpayable', inputs: [{ name: 'strategyId', type: 'bytes32' }], outputs: [] },
] as const

