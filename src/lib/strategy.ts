import { defaultExpiryBuffer, marketWindows, type MarketInterval } from './market-windows'

export type TriggerType = 'LAST_FILL_PRICE_ABOVE' | 'LAST_FILL_PRICE_BELOW'
export type ActionType = 'BUY_UP' | 'BUY_DOWN'

export interface StrategyManifest {
  version: 1
  name: string
  series: { asset: 'BTC' | 'ETH'; intervalSec: MarketInterval }
  trigger: { type: TriggerType; value: string }
  action: { type: ActionType; maxCollateral: string; maxSlippageBps: number; sizing?: { mode: 'WIN_LADDER'; initialCollateral: string; incrementCollateral: string } }
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
const supportedIntervals = new Set<number>([...marketWindows.map(window => window.seconds), 3600])

/** Keep a compatible user buffer; replace one that cannot fit the selected window. */
export function changeMarketWindow(manifest: StrategyManifest, intervalSec: MarketInterval): StrategyManifest {
  return {
    ...manifest,
    series: { ...manifest.series, intervalSec },
    policy: { ...manifest.policy, minSecondsToExpiry: manifest.policy.minSecondsToExpiry >= intervalSec
      ? defaultExpiryBuffer(intervalSec) : manifest.policy.minSecondsToExpiry },
  }
}

export function validateManifest(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const get = (path: string): unknown => path.split('.').reduce<unknown>((value, key) =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, input)
  const required = (path: string, valid: (value: unknown) => boolean, message: string) => {
    if (!valid(get(path))) issues.push({ path, message: `${path}: ${message}` })
  }
  const integer = (path: string, min: number, max: number) => required(path,
    v => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max,
    `An explicit integer between ${min} and ${max} is required.`)
  const decimal = (path: string, min: number, max: number) => required(path,
    v => typeof v === 'string' && /^\d+(?:\.\d{1,6})?$/.test(v) && Number(v) >= min && Number(v) <= max,
    `An explicit decimal between ${min} and ${max} (up to 6 decimals) is required.`)
  required('version', v => v === 1, 'Unsupported manifest version.')
  required('name', v => typeof v === 'string' && v.trim().length > 0, 'Name is required.')
  required('series.asset', v => supportedAssets.has(v as string), 'Unsupported or missing asset.')
  required('series.intervalSec', v => supportedIntervals.has(v as number), 'Unsupported or missing cadence.')
  required('trigger.type', v => v === 'LAST_FILL_PRICE_ABOVE' || v === 'LAST_FILL_PRICE_BELOW', 'Unsupported or missing trigger.')
  required('action.type', v => v === 'BUY_UP' || v === 'BUY_DOWN', 'Unsupported or missing action.')
  decimal('trigger.value', 0, 1)
  decimal('action.maxCollateral', 0.000001, 10)
  decimal('policy.maxTotalCapitalAtRisk', 0.000001, Number.MAX_SAFE_INTEGER / 1e6)
  if (Number(get('policy.maxTotalCapitalAtRisk')) < Number(get('action.maxCollateral'))) {
    issues.push({ path: 'policy.maxTotalCapitalAtRisk', message: 'Hard cap cannot be below one order.' })
  }
  if(get('action.sizing') !== undefined) {
    required('action.sizing.mode',v=>v==='WIN_LADDER','Unsupported sizing rule.')
    decimal('action.sizing.initialCollateral',0.000001,10)
    decimal('action.sizing.incrementCollateral',0.000001,10)
    if(Number(get('action.sizing.initialCollateral'))>Number(get('action.maxCollateral'))) issues.push({path:'action.sizing.initialCollateral',message:'Initial order must fit the per-order cap.'})
    if(Number(get('action.sizing.incrementCollateral'))>Number(get('action.maxCollateral'))) issues.push({path:'action.sizing.incrementCollateral',message:'Ladder increment must fit the per-order cap.'})
    required('policy.stopAfterConsecutiveLosses',v=>v===1,'A ladder stops on its first loss.')
  }
  integer('action.maxSlippageBps', 0, 1000)
  integer('policy.maxRounds', 1, 65535)
  integer('policy.stopAfterConsecutiveLosses', 1, 65535)
  integer('policy.minSecondsToExpiry', 1, 4294967295)
  if (supportedIntervals.has(get('series.intervalSec') as number) && Number(get('policy.minSecondsToExpiry')) >= Number(get('series.intervalSec'))) {
    issues.push({ path: 'policy.minSecondsToExpiry', message: 'Expiry buffer must be shorter than the market window.' })
  }
  integer('resolution.onWin.rollPercent', 0, 100)
  required('resolution.onLoss.incrementConsecutiveLosses', v => v === true, 'P0 losses must increment the loss counter.')
  required('resolution.onVoid.treatAsLoss', v => v === false, 'P0 voids must be neutral.')
  required('resolution.onVoid.treatAsWin', v => v === false, 'P0 voids must be neutral.')
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

export type StrategyDraft = {
  [K in keyof StrategyManifest]?: StrategyManifest[K] extends object ? Partial<StrategyManifest[K]> : StrategyManifest[K]
}

/** Conservative local compiler. Omitted fields remain absent; never merge with a preset. */
export function compileIntent(text: string): StrategyDraft {
  // Normalize supported Turkish intent phrases, preserving omitted fields as missing.
  text=text.toLocaleLowerCase('tr-TR').replace(/ı/g,'i')
    .replace(/(\d+(?:\.\d+)?)\s*(?:cent|sent|cent’i|cent'i)(?:[’']?i)?\s*(?:geçerse|üzerine çikarsa)/g,'above $1%')
    .replace(/(\d+(?:\.\d+)?)\s*(?:cent|sent)(?:[’']?in)?\s*altina düşerse/g,'below $1%')
    .replace(/\b(up|down)\s+al\b/g,'buy $1').replace(/iki kayipta dur/g,'stop after two losses')
    .replace(/(\d+) kayipta dur/g,'stop after $1 losses').replace(/(\d+(?:\.\d+)?)\s*(?:usdc|tusdc|usdso)\s*(?:ile|tutarinda)/g,'with $1')
  const lower = text.toLowerCase()
  if(/\b(?:don't|do not|never buy|alma)\b/i.test(text)||(/buy up/i.test(text)&&/buy down/i.test(text)))return {version:1,name:'Unresolved intent'}
  const threshold = text.match(/(?:above|over|greater than|>|below|under|<)\s*(?:up\s*)?([0-9]+(?:\.[0-9]+)?)(%)?/i)
  const capture = (pattern: RegExp) => text.match(pattern)?.[1]
  const ladderRequested=/ladder|increase.+win|win.+increase/i.test(text)
  const initial=capture(/(?:start|initial)\s*(?:order\s*)?(?:with|at|:)?\s*([0-9]+(?:\.[0-9]+)?)/i)
  const increment=capture(/increase\s*(?:by|:)\s*([0-9]+(?:\.[0-9]+)?)/i)
  const orderCap=capture(/max(?:imum)? order(?: size)?\s*(?:of|:)?\s*([0-9]+(?:\.[0-9]+)?)/i)
  const budget = ladderRequested?(orderCap??''):capture(/(?:with|amount)\s*([0-9]+(?:\.[0-9]+)?)/i)
  const cap = capture(/(?:risk|cap|capital)[^0-9.]*([0-9]+(?:\.[0-9]+)?)/i)
  const roll = capture(/roll\s*(half|[0-9]+%)/i)
  const losses = capture(/(?:after|at)\s*(first|one|two|[0-9]+)\s*loss/i)
  const rounds = capture(/(?:max(?:imum)?\s*)?([0-9]+)\s*rounds/i)
  const slippage = capture(/(?:slippage\s*(?:of|cap|:)?\s*)([0-9]+)\s*bps/i) ?? capture(/([0-9]+)\s*bps\s*(?:max\s*)?slippage/i)
  const expiry = capture(/(?:expiry buffer|buffer|min(?:imum)? seconds to expiry)\s*(?:of|:)?\s*([0-9]+)/i)
  return {
    version: 1, name: 'Intent draft',
    series: {
      ...(/\bbtc\b/i.test(text) ? { asset: 'BTC' as const } : /\beth\b/i.test(text) ? { asset: 'ETH' as const } : {}),
      ...(/\b1\s*(?:m|min(?:ute)?s?|dk|dakika)\b/i.test(text) ? { intervalSec: 60 as const } : /\b5\s*(?:m|min(?:ute)?s?|dk|dakika)\b/i.test(text) ? { intervalSec: 300 as const } : /\b(?:15m|15 min)\b/i.test(text) ? { intervalSec: 900 as const } : /\b(?:1h|60m|1 hour)\b/i.test(text) ? { intervalSec: 3600 as const } : {}),
    },
    trigger: threshold ? {
      type: /below|under|</i.test(threshold[0]) ? 'LAST_FILL_PRICE_BELOW' : 'LAST_FILL_PRICE_ABOVE',
      value: String(Number(threshold[1]) / (threshold[2] ? 100 : 1)),
    } : {},
    action: {
      ...(/buy up/i.test(lower) ? { type: 'BUY_UP' as const } : /buy down/i.test(lower) ? { type: 'BUY_DOWN' as const } : {}),
      ...(budget !== undefined ? { maxCollateral: budget } : {}),
      ...(ladderRequested?{sizing:{mode:'WIN_LADDER' as const,initialCollateral:initial??'',incrementCollateral:increment??''}}:{}),
      ...(slippage !== undefined ? { maxSlippageBps: Number(slippage) } : {}),
    },
    resolution: {
      ...(ladderRequested?{onWin:{rollPercent:0}}:{}),
      ...(roll ? { onWin: { rollPercent: roll.toLowerCase() === 'half' ? 50 : Number(roll.slice(0, -1)) } } : {}),
      onLoss: { incrementConsecutiveLosses: true }, onVoid: { treatAsLoss: false, treatAsWin: false },
    },
    policy: {
      ...(cap !== undefined ? { maxTotalCapitalAtRisk: cap } : {}),
      ...(rounds !== undefined ? { maxRounds: Number(rounds) } : {}),
      ...(losses !== undefined ? { stopAfterConsecutiveLosses: losses.toLowerCase() === 'two' ? 2 : /first|one/i.test(losses)?1:Number(losses) } : {}),
      ...(expiry !== undefined ? { minSecondsToExpiry: Number(expiry) } : {}),
    },
  }
}
