/// <reference types="vite/client" />

import type { InjectedProvider } from './lib/wallet'

declare global {
  interface Window {
    ethereum?: InjectedProvider
  }
}
