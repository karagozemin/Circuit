import type { Hex } from 'viem'

export function requirePrivateKey(value: string | undefined): Hex {
  const trimmed = value?.trim()
  const normalized = trimmed?.startsWith('0x') ? trimmed : trimmed ? `0x${trimmed}` : ''
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('CIRCUIT_OPERATOR_PRIVATE_KEY must contain exactly 32 bytes of hexadecimal data.')
  }
  return normalized as Hex
}
