import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoverWorkspaceLoad } from './workspace-loading'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function browser() {
  const storage = new Map<string, string>()
  const reload = vi.fn()
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  }
  vi.stubGlobal('window', { sessionStorage, location: { reload } })
  return { reload, sessionStorage }
}

describe('workspace module recovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: /assets/Workspace-old.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/Workspace-old.css',
  ])('refreshes stale or failed assets: %s', message => {
    const { reload } = browser()
    expect(recoverWorkspaceLoad(new TypeError(message))).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not loop when the failure persists across reloads', () => {
    const { reload } = browser()
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    const error = new TypeError('Failed to fetch dynamically imported module')
    expect(recoverWorkspaceLoad(error)).toBe(true)
    now.mockReturnValue(100_500)
    expect(recoverWorkspaceLoad(error)).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
    now.mockReturnValue(161_000)
    expect(recoverWorkspaceLoad(error)).toBe(true)
  })

  it('leaves ordinary application errors to the error screen', () => {
    const { reload } = browser()
    expect(recoverWorkspaceLoad(new Error('Invalid saved data'))).toBe(false)
    expect(recoverWorkspaceLoad(null)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload if it cannot persist the loop guard', () => {
    const { reload, sessionStorage } = browser()
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    expect(recoverWorkspaceLoad(new TypeError('Failed to fetch dynamically imported module'))).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
