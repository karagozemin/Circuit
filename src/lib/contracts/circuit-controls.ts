/** Ending through the UI requires a paused strategy so no keeper can open a position while the wallet confirms. */
export function endCircuitBlocker(runtime?: {status:number;currentPositionSize:bigint}): string | undefined {
  if (!runtime) return 'Wait for the current circuit state to be verified.'
  if ([8,9].includes(runtime.status)) return 'This circuit has already ended.'
  if (runtime.currentPositionSize > 0n) return 'Settle the open position before ending this circuit. If paused, resume it first.'
  if (runtime.status !== 7) return 'Pause this circuit first, then end it to activate another draft.'
}
