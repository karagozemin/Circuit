export type TriggerType = 'LAST_FILL_PRICE_ABOVE' | 'LAST_FILL_PRICE_BELOW'
export type ActionType = 'BUY_UP' | 'BUY_DOWN'

export interface StrategyManifest {
  version: 1
  name: string
  series: { asset: 'BTC' | 'ETH'; intervalSec: 900 | 3600 }
  trigger: { type: TriggerType; value: string }
  action: { type: ActionType; maxCollateral: string; maxSlippageBps: number }
  resolution: {
    onWin: { rollPercent: number }
    onLoss: { incrementConsecutiveLosses: boolean }
    onVoid: { treatAsLoss: boolean; treatAsWin: boolean }
  }
  policy: {
    maxTotalCapitalAtRisk: string
    maxRounds: number
    stopAfterConsecutiveLosses: number
    minSecondsToExpiry: number
  }
}

export const initialManifest: StrategyManifest = {
  version: 1,
  name: 'Contrarian Roller',
  series: { asset: 'BTC', intervalSec: 900 },
  trigger: { type: 'LAST_FILL_PRICE_ABOVE', value: '0.700' },
  action: { type: 'BUY_DOWN', maxCollateral: '10.0', maxSlippageBps: 200 },
  resolution: { onWin: { rollPercent: 50 }, onLoss: { incrementConsecutiveLosses: true }, onVoid: { treatAsLoss: false, treatAsWin: false } },
  policy: { maxTotalCapitalAtRisk: '20.0', maxRounds: 5, stopAfterConsecutiveLosses: 2, minSecondsToExpiry: 120 },
}

export type ValidationIssue = { path: string; message: string }

const supportedAssets = new Set(['BTC', 'ETH'])
const supportedIntervals = new Set([900, 3600])

export function validateManifest(manifest: StrategyManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const number = (value: string, path: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) issues.push({ path, message: 'Must be a non-negative number.' })
    return parsed
  }
  const maxOrder = number(manifest.action.maxCollateral, 'action.maxCollateral')
  const cap = number(manifest.policy.maxTotalCapitalAtRisk, 'policy.maxTotalCapitalAtRisk')
  const trigger = number(manifest.trigger.value, 'trigger.value')
  if (!manifest.name.trim()) issues.push({ path: 'name', message: 'Name is required.' })
  if (!supportedAssets.has(manifest.series.asset)) issues.push({ path: 'series.asset', message: 'Unsupported asset.' })
  if (!supportedIntervals.has(manifest.series.intervalSec)) issues.push({ path: 'series.intervalSec', message: 'Unsupported cadence.' })
  if (trigger < 0 || trigger > 1) issues.push({ path: 'trigger.value', message: 'Probability must be between 0 and 1.' })
  if (maxOrder <= 0) issues.push({ path: 'action.maxCollateral', message: 'Max order collateral must be greater than 0.' })
  if (maxOrder > 10) issues.push({ path: 'action.maxCollateral', message: 'P0 max order collateral is capped at 10.' })
  if (cap <= 0) issues.push({ path: 'policy.maxTotalCapitalAtRisk', message: 'Hard capital cap is required.' })
  if (cap < maxOrder) issues.push({ path: 'policy.maxTotalCapitalAtRisk', message: 'Hard cap cannot be below one order.' })
  if (!Number.isInteger(manifest.policy.maxRounds) || manifest.policy.maxRounds < 1) issues.push({ path: 'policy.maxRounds', message: 'At least one round is required.' })
  if (!Number.isInteger(manifest.policy.stopAfterConsecutiveLosses) || manifest.policy.stopAfterConsecutiveLosses < 1) issues.push({ path: 'policy.stopAfterConsecutiveLosses', message: 'Loss stop must be at least 1.' })
  if (manifest.resolution.onWin.rollPercent < 0 || manifest.resolution.onWin.rollPercent > 100) issues.push({ path: 'resolution.onWin.rollPercent', message: 'Roll percent must be 0–100.' })
  if (manifest.action.maxSlippageBps < 0 || manifest.action.maxSlippageBps > 1000) issues.push({ path: 'action.maxSlippageBps', message: 'Slippage must be between 0 and 1000 bps.' })
  if (manifest.policy.minSecondsToExpiry < 0) issues.push({ path: 'policy.minSecondsToExpiry', message: 'Expiry buffer cannot be negative.' })
  return issues
}

export function canonicalManifest(manifest: StrategyManifest): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, sortKeys(child)]),
      )
    }
    return value
  }
  return JSON.stringify(sortKeys(manifest))
}

export function compileIntent(text: string): Partial<StrategyManifest> {
  const lower = text.toLowerCase()
  const asset = lower.includes('eth') ? 'ETH' : 'BTC'
  const intervalSec = lower.includes('1h') || lower.includes('60m') ? 3600 : 900
  const threshold = text.match(/(?:above|over|greater than|>|üstünde|üzerinde)\s*(?:up\s*)?([0-9]+(?:\.[0-9]+)?)/i)?.[1]
  const budget = text.match(/(?:with|max(?:imum)?|amount)\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1]
  const cap = text.match(/(?:risk|cap|capital)[^0-9]*([0-9]+(?:\.[0-9]+)?)/i)?.[1]
  const roll = text.match(/roll\s*(?:half|50%|([0-9]+)%)/i)
  const losses = text.match(/(?:after|at)\s*(?:two|2|([0-9]+))\s*loss/i)?.[1]
  return {
    version: 1,
    name: 'Agent draft · Contrarian Roller',
    series: { asset, intervalSec },
    trigger: { type: 'LAST_FILL_PRICE_ABOVE', value: threshold ? (Number(threshold) > 1 ? (Number(threshold) / 100).toFixed(3) : Number(threshold).toFixed(3)) : '0.700' },
    action: { type: lower.includes('buy up') ? 'BUY_UP' : 'BUY_DOWN', maxCollateral: budget ?? '10.0', maxSlippageBps: 200 },
    resolution: { onWin: { rollPercent: roll?.[1] ? Number(roll[1]) : 50 }, onLoss: { incrementConsecutiveLosses: true }, onVoid: { treatAsLoss: false, treatAsWin: false } },
    policy: { maxTotalCapitalAtRisk: cap ?? '20.0', maxRounds: 5, stopAfterConsecutiveLosses: losses ? Number(losses) : 2, minSecondsToExpiry: 120 },
  }
}
