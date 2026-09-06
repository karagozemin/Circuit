import { isAddress, type Address, type Hex } from 'viem'

/** SDK 0.2.1 declares a named result but viem returns the ABI's two-output tuple. */
export function normalizeSubscriptionInfo(value: unknown) {
  if (value instanceof Error) throw value
  const raw = value as { subscriptionData?: unknown; owner?: unknown } | null
  const data = (Array.isArray(value) ? value[0] : raw?.subscriptionData) as {
    handlerContractAddress?: unknown; emitter?: unknown; eventTopics?: unknown
  } | undefined
  const owner = Array.isArray(value) ? value[1] : raw?.owner
  if (!data || typeof owner !== 'string' || !isAddress(owner)
    || typeof data.handlerContractAddress !== 'string' || !isAddress(data.handlerContractAddress)
    || typeof data.emitter !== 'string' || !isAddress(data.emitter)
    || !Array.isArray(data.eventTopics) || !data.eventTopics.every(topic => typeof topic === 'string' && /^0x[\da-f]{64}$/i.test(topic))) {
    throw new Error('Invalid subscription information returned by the precompile.')
  }
  return { owner: owner as Address, subscriptionData: {
    handlerContractAddress: data.handlerContractAddress as Address,
    emitter: data.emitter as Address, eventTopics: data.eventTopics as Hex[],
  } }
}
