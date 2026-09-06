export class MarketDiscoveryError extends Error {
  constructor(public readonly kind: 'unavailable' | 'connection', message: string) {
    super(message)
    this.name = 'MarketDiscoveryError'
  }
}
