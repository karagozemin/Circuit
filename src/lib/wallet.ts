import { formatEther, getAddress, type Address } from 'viem'

export const SHANNON_CHAIN_ID = 50_312
export const SHANNON_CHAIN_ID_HEX = '0xc488'
export const WALLET_AUTOCONNECT_KEY = 'circuit.wallet.autoconnect'

export interface InjectedProvider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
  on?(event: 'accountsChanged' | 'chainChanged' | 'disconnect', listener: (...args: unknown[]) => void): void
  removeListener?(event: 'accountsChanged' | 'chainChanged' | 'disconnect', listener: (...args: unknown[]) => void): void
}

export interface WalletSnapshot {
  address: Address
  chainId: number
  balance: bigint
}

export const shannonNetwork = {
  chainId: SHANNON_CHAIN_ID_HEX,
  chainName: 'Somnia Shannon Testnet',
  nativeCurrency: { name: 'Somnia Test Token', symbol: 'STT', decimals: 18 },
  rpcUrls: ['https://dream-rpc.somnia.network'],
  blockExplorerUrls: ['https://shannon-explorer.somnia.network'],
}

function accountFrom(value: unknown): Address | null {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return null
  return getAddress(value[0])
}

export async function readWallet(provider: InjectedProvider, requestAccess = false): Promise<WalletSnapshot | null> {
  const accounts = await provider.request({ method: requestAccess ? 'eth_requestAccounts' : 'eth_accounts' })
  const address = accountFrom(accounts)
  if (!address) return null

  const [chainValue, balanceValue] = await Promise.all([
    provider.request({ method: 'eth_chainId' }),
    provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }),
  ])
  if (typeof chainValue !== 'string' || typeof balanceValue !== 'string') {
    throw new Error('Wallet returned an invalid chain or balance response.')
  }

  return { address, chainId: Number(BigInt(chainValue)), balance: BigInt(balanceValue) }
}

function errorCode(error: unknown): number | undefined {
  let current = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown }
    if (typeof record.code === 'number') return record.code
    current = record.cause
  }
  return undefined
}

export async function switchToShannon(provider: InjectedProvider) {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SHANNON_CHAIN_ID_HEX }] })
  } catch (error) {
    if (errorCode(error) !== 4_902) throw error
    await provider.request({ method: 'wallet_addEthereumChain', params: [shannonNetwork] })
  }
}

export function shortAddress(address: Address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function formatSttBalance(balance: bigint) {
  const value = Number(formatEther(balance))
  if (value === 0) return '0 STT'
  if (value < 0.0001) return '<0.0001 STT'
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 4 })} STT`
}

export function walletErrorMessage(error: unknown) {
  if (errorCode(error) === 4_001) return 'Wallet request was rejected.'
  return error instanceof Error ? error.message : 'Wallet request failed.'
}
