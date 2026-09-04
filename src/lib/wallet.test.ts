import { describe, expect, it, vi } from 'vitest'
import {
  formatSttBalance,
  readWallet,
  shortAddress,
  SHANNON_CHAIN_ID,
  switchToShannon,
  walletErrorMessage,
  type InjectedProvider,
} from './wallet'

describe('injected wallet integration', () => {
  it('reads the connected account, chain and native balance', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(['0x000000000000000000000000000000000000bEEF'])
      .mockResolvedValueOnce('0xc488')
      .mockResolvedValueOnce('0xde0b6b3a7640000')

    const wallet = await readWallet({ request }, true)
    expect(wallet).toEqual({
      address: '0x000000000000000000000000000000000000bEEF',
      chainId: SHANNON_CHAIN_ID,
      balance: 1_000_000_000_000_000_000n,
    })
    expect(formatSttBalance(wallet!.balance)).toBe('1 STT')
    expect(shortAddress(wallet!.address)).toBe('0x0000...bEEF')
  })

  it('adds Shannon when the wallet does not know the chain', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce({ code: 4_902 })
      .mockResolvedValueOnce(null)
    await switchToShannon({ request })
    expect(request.mock.calls[1][0].method).toBe('wallet_addEthereumChain')
  })

  it('does not hide a rejected signature or network request', () => {
    expect(walletErrorMessage({ code: 4_001 })).toBe('Wallet request was rejected.')
  })

  it('returns null when no account has granted access', async () => {
    const provider: InjectedProvider = { request: vi.fn().mockResolvedValue([]) }
    await expect(readWallet(provider)).resolves.toBeNull()
  })
})
