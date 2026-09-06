import { describe, expect, it } from 'vitest'
import { endCircuitBlocker } from './circuit-controls'

describe('ending a circuit', () => {
  it('requires a verified state', () => {
    expect(endCircuitBlocker()).toContain('verified')
  })
  it.each([1,2,3,4,5,6])('requires pausing status %i before the wallet can confirm cancellation', status => {
    expect(endCircuitBlocker({status,currentPositionSize:0n})).toContain('Pause')
  })
  it.each([5,7])('does not abandon an open position in status %i', status => {
    expect(endCircuitBlocker({status,currentPositionSize:1n})).toContain('Settle')
  })
  it.each([8,9])('cannot end terminal status %i again', status => {
    expect(endCircuitBlocker({status,currentPositionSize:0n})).toContain('already ended')
  })
  it('allows ending a paused circuit with no position', () => {
    expect(endCircuitBlocker({status:7,currentPositionSize:0n})).toBeUndefined()
  })
})
