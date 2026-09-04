import { describe, expect, it } from 'vitest'
import { parseDeployment } from './activation'

describe('Circuit deployment configuration', () => {
  it('accepts a complete address pair and checksums it', () => {
    expect(parseDeployment(
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    )).toEqual({
      engine: '0x0000000000000000000000000000000000000001',
      handler: '0x0000000000000000000000000000000000000002',
    })
  })

  it('fails closed for missing or malformed addresses', () => {
    expect(parseDeployment(undefined, undefined)).toBeUndefined()
    expect(parseDeployment('not-an-address', '0x0000000000000000000000000000000000000002')).toBeUndefined()
  })
})
