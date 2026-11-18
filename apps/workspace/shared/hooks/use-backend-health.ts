import { checkBackendHealth } from '@/adapters/api/config'

const CACHE_TTL_MS = 5_000

let cachedResult: boolean | null = null
let cachedAt = 0

export const checkBackendHealthCached = async (): Promise<boolean> => {
  const now = Date.now()

  if (cachedResult !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedResult
  }

  const isHealthy = await checkBackendHealth()
  cachedResult = isHealthy
  cachedAt = now
  return isHealthy
}

export const invalidateHealthCache = (): void => {
  cachedResult = null
  cachedAt = 0
}
