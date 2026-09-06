import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TradingMarketSnapshot } from '../dreamdex/discovery'
import { initialManifest } from '../strategy'

const { readContract, getCode, getBlock } = vi.hoisted(() => ({
  readContract: vi.fn(), getCode: vi.fn(), getBlock: vi.fn(),
}))
vi.mock('viem', async importOriginal => ({
  ...await importOriginal<typeof import('viem')>(),
  createPublicClient: () => ({ readContract, getCode, getBlock }),
}))
let inspectActivation: typeof import('./activation').inspectActivation

const owner = '0x0000000000000000000000000000000000000001' as const
const engine = '0x0000000000000000000000000000000000000002' as const
const handler = '0x0000000000000000000000000000000000000003' as const
const account = '0x0000000000000000000000000000000000000004' as const
const market: TradingMarketSnapshot = {
  marketId: `0x${'01'.repeat(32)}`, marketAddress: account, collateral: account,
  collateralDecimals: 6, pool: account, asset: 'ETH', intervalSec: 3600,
  question: 'Test market', expiry: 2000, secondsToExpiry: 1000,
  outcomeToken: account, yesId: 1n, noId: 2n, yesSymbol: 'UP', noSymbol: 'DOWN',
  bestYesBid: null, bestYesAsk: null, indexedStatus: 'Trading', onchainStatus: 1,
  blockNumber: 20n, blockTimestamp: 1000,
}
const wallet = { address: owner, balance: 50n * 10n ** 18n, chainId: 50312 }
let reads: Record<string, unknown>

beforeEach(async () => {
  vi.stubEnv('VITE_CIRCUIT_ENGINE_ADDRESS', engine)
  vi.stubEnv('VITE_CIRCUIT_HANDLER_ADDRESS', handler)
  vi.stubEnv('VITE_CIRCUIT_SMART_ACCOUNT_ADDRESS', account)
  vi.resetModules()
  ;({ inspectActivation } = await import('./activation'))
  getCode.mockResolvedValue('0x1234')
  getBlock.mockResolvedValue({ timestamp: 1000n, number: 20n })
  reads = { reactivityHandler: handler, status: 1, expiry: 2000n, owner, executor: engine, balanceOf: 0n, allowance: 0n }
  readContract.mockImplementation(({ functionName }) => Promise.resolve(reads[functionName]))
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('account preparation readiness', () => {
  it('offers preparation for a correctly owned account missing collateral or allowance', async () => {
    const result = await inspectActivation(wallet, market, initialManifest)
    expect(result).toMatchObject({ ready: false, canPrepareAccount: true })
  })
  it.each(['owner', 'executor'])('does not offer preparation for a mismatched %s', async field => {
    reads[field] = '0x0000000000000000000000000000000000000099'
    expect(await inspectActivation(wallet, market, initialManifest)).toMatchObject({ ready: false, canPrepareAccount: false })
  })
  it('does not offer preparation for a closed market', async () => {
    reads.status = 2
    expect(await inspectActivation(wallet, market, initialManifest)).toMatchObject({ ready: false, canPrepareAccount: false })
  })
  it('enables activation once both the account balance and pool allowance cover the order', async () => {
    reads.balanceOf = 10_000_000n
    reads.allowance = 10_000_000n
    expect(await inspectActivation(wallet, market, initialManifest)).toMatchObject({ ready: true, canPrepareAccount: false })
  })
})


describe('combined setup compatibility', () => {
  it('detects a deployment supporting atomic setup', async () => {
    reads.activationSetupVersion = 1n
    reads.balanceOf = reads.allowance = 10_000_000n
    expect(await inspectActivation(wallet, market, initialManifest)).toMatchObject({ ready: true, supportsCombinedSetup: true })
  })
  it('keeps legacy deployments usable when feature detection reverts', async () => {
    reads.balanceOf = reads.allowance = 10_000_000n
    readContract.mockImplementation(({ functionName }) => functionName === 'activationSetupVersion'
      ? Promise.reject(new Error('Unknown function')) : Promise.resolve(reads[functionName]))
    expect(await inspectActivation(wallet, market, initialManifest)).toMatchObject({ ready: true, supportsCombinedSetup: false })
  })
  it('does not assume compatibility with unknown setup versions', async () => {
    reads.activationSetupVersion = 2n
    expect(await inspectActivation(wallet, market, initialManifest)).toMatchObject({ supportsCombinedSetup: false })
  })
})
