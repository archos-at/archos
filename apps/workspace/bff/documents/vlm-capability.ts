import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'

const PROBE_TIMEOUT_MS = 5_000

const CACHE_TTL_MS = 30_000

interface CacheEntry {
  value: boolean
  expiresAt: number
}

let cache: CacheEntry | null = null

export function __resetVlmCapabilityCache(): void {
  cache = null
}

export async function isVlmConfigured(now: number = Date.now()): Promise<boolean> {
  if (cache && cache.expiresAt > now) {
    return cache.value
  }

  let value = false
  try {
    const response = await fetch(`${getBackendUrl()}/v1/data_sources`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (response.ok) {
      const data: unknown = await response.json()
      value =
        !Array.isArray(data) &&
        typeof data === 'object' &&
        data !== null &&
        (data as { vlm_available?: unknown }).vlm_available === true
    }
  } catch {
    value = false
  }

  cache = { value, expiresAt: now + CACHE_TTL_MS }
  return value
}
