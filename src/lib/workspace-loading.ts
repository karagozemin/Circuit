const RELOAD_KEY = 'circuit.workspace.load-recovery'
const RELOAD_COOLDOWN_MS = 60_000

/** A stale deployment or interrupted chunk download can recover with fresh HTML. */
export function recoverWorkspaceLoad(error: unknown): boolean {
  if (!(error instanceof Error) || !/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(error.message)) {
    return false
  }

  try {
    const previous = window.sessionStorage.getItem(RELOAD_KEY)
    const now = Date.now()
    if (previous !== null && now - Number(previous) < RELOAD_COOLDOWN_MS) return false

    // Record before reloading so a persistent failure cannot cause a reload loop.
    // If storage is unavailable, leave recovery to the visible reload button.
    window.sessionStorage.setItem(RELOAD_KEY, String(now))
    window.location.reload()
    return true
  } catch {
    return false
  }
}
