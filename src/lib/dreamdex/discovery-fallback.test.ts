import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarketDiscoveryError } from './discovery-error'

const { chainDiscovery } = vi.hoisted(() => ({ chainDiscovery: vi.fn() }))
vi.mock('./chain-discovery', () => ({ discoverFromChain: chainDiscovery }))
vi.mock('./config', () => ({
  createDreamDexExchange: () => { throw new Error('Indexer unreachable') },
  SHANNON_RPC_URL: 'https://example.test',
  SHANNON_FALLBACK_RPC_URL: 'https://example.test',
  SHANNON_DIAGNOSTIC_RPC_URL: 'https://example.test',
}))
import { discoverTradingMarket } from './discovery'

afterEach(() => vi.clearAllMocks())

describe('discovery fallback feedback', () => {
  it('uses verified chain results when the indexer fails', async () => {
    const snapshot = { marketId: 'verified-on-chain' }
    chainDiscovery.mockResolvedValueOnce(snapshot)
    await expect(discoverTradingMarket({ asset: 'ETH', intervalSec: 3600 })).resolves.toBe(snapshot)
    expect(chainDiscovery).toHaveBeenCalledWith({ asset: 'ETH', intervalSec: 3600 })
  })

  it('keeps a completed search with no eligible market distinct from connection failure', async () => {
    const unavailable = new MarketDiscoveryError('unavailable', 'No verified window')
    chainDiscovery.mockRejectedValueOnce(unavailable)
    await expect(discoverTradingMarket()).rejects.toBe(unavailable)
  })

  it('reports connection failure when both verification paths fail', async () => {
    chainDiscovery.mockRejectedValueOnce(new Error('RPC timed out'))
    await expect(discoverTradingMarket()).rejects.toMatchObject({
      kind: 'connection',
      message: expect.stringMatching(/Indexer unreachable.*RPC timed out/),
    })
  })
})
