export const marketWindows = [
  { seconds: 60, label: '1 minute', shortLabel: '1 min', description: 'A quick window', defaultBuffer: 10 },
  { seconds: 300, label: '5 minutes', shortLabel: '5 min', description: 'A little more time', defaultBuffer: 30 },
  { seconds: 900, label: '15 minutes', shortLabel: '15 min', description: 'A shorter horizon', defaultBuffer: 120 },
] as const

// Keep existing saved and on-chain hourly strategies readable.
export type MarketInterval = typeof marketWindows[number]['seconds'] | 3600
export function marketWindowLabel(seconds: number) {
  return marketWindows.find(window => window.seconds === seconds)?.shortLabel ?? (seconds === 3600 ? '1 hour' : `${seconds / 60} min`)
}
export function defaultExpiryBuffer(seconds: MarketInterval) {
  return marketWindows.find(window => window.seconds === seconds)?.defaultBuffer ?? 120
}
