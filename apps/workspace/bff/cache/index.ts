import { createRedisClient } from '@/lib/redis/connect.js'

export interface CacheStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  deletePrefix(prefix: string): Promise<void>
  increment?(key: string, by: number, ttlMs: number): Promise<number>
}

export interface CacheCounters {
  hits: number
  misses: number
  errors: number
}

const counters: CacheCounters = { hits: 0, misses: 0, errors: 0 }

export function readCacheCounters(): CacheCounters {
  return { ...counters }
}

export function resetCacheCounters(): void {
  counters.hits = 0
  counters.misses = 0
  counters.errors = 0
}

const MAX_LOCAL_ENTRIES = 5000

interface LocalEntry {
  value: string
  expiresAt: number
}

class InProcessStore implements CacheStore {
  private entries = new Map<string, LocalEntry>()

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    if (this.entries.size >= MAX_LOCAL_ENTRIES) {
      const overflow = this.entries.size - MAX_LOCAL_ENTRIES + 1
      const keys = this.entries.keys()
      for (let i = 0; i < overflow; i++) {
        const next = keys.next()
        if (next.done) break
        this.entries.delete(next.value)
      }
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  async increment(key: string, by: number, ttlMs: number): Promise<number> {
    const held = this.entries.get(key)
    const live = held && Date.now() < held.expiresAt ? held : null
    const total = (live ? Number(live.value) || 0 : 0) + by
    this.entries.set(key, { value: String(total), expiresAt: live ? live.expiresAt : Date.now() + ttlMs })
    return total
  }
}

export class RedisStore implements CacheStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any

  constructor(url: string) {
    this.client = createRedisClient(url, 'cache', { commandTimeout: 500 })
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(key, value, 'PX', Math.max(1, Math.round(ttlMs)))
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key)
  }

  async increment(key: string, by: number, ttlMs: number): Promise<number> {
    const ms = Math.max(1, Math.round(ttlMs))
    const results = await this.client.multi().incrby(key, by).pexpire(key, ms, 'NX').exec()
    const [[addError, total] = [], [expireError] = []] = results ?? []
    if (addError) throw addError
    if (expireError && (await this.client.pttl(key)) < 0) await this.client.pexpire(key, ms)
    return Number(total)
  }

  async deletePrefix(prefix: string): Promise<void> {
    let cursor = '0'
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
      if (keys.length > 0) await this.client.del(...keys)
      cursor = next
    } while (cursor !== '0')
  }
}

const createDefaultStore = (): CacheStore => {
  const url = process.env.REDIS_URL
  if (url) {
    try {
      return new RedisStore(url)
    } catch (error) {
      console.warn('[cache] failed to initialize redis store, using in-process cache:', error)
    }
  }
  return new InProcessStore()
}

let store: CacheStore = createDefaultStore()

export function setCacheStore(next: CacheStore): void {
  store = next
}

export interface GetCachedOptions {
  negativeTtlMs?: number
}

export async function getCached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  options?: GetCachedOptions,
): Promise<T> {
  try {
    const hit = await store.get(key)
    if (hit !== null) {
      const parsed = JSON.parse(hit) as T
      counters.hits += 1
      return parsed
    }
  } catch (error) {
    counters.errors += 1
    counters.misses += 1
    console.warn(`[cache] read failed for ${key}:`, error)
    return loader()
  }

  counters.misses += 1
  const value = await loader()
  const ttl = value === null || value === undefined ? (options?.negativeTtlMs ?? ttlMs) : ttlMs
  try {
    await store.set(key, JSON.stringify(value ?? null), ttl)
  } catch (error) {
    counters.errors += 1
    console.warn(`[cache] write failed for ${key}:`, error)
  }
  return value
}

export async function setCached<T>(key: string, value: T, ttlMs: number): Promise<void> {
  try {
    await store.set(key, JSON.stringify(value ?? null), ttlMs)
  } catch (error) {
    counters.errors += 1
    console.warn(`[cache] direct write failed for ${key}:`, error)
  }
}

export async function incrementCounter(key: string, by: number, ttlMs: number): Promise<number | null> {
  try {
    if (!store.increment) return null
    const total = await store.increment(key, by, ttlMs)
    return Number.isFinite(total) ? total : null
  } catch (error) {
    counters.errors += 1
    console.warn(`[cache] counter increment failed for ${key}:`, error)
    return null
  }
}

export async function invalidateCached(key: string): Promise<void> {
  try {
    await store.delete(key)
  } catch (error) {
    counters.errors += 1
    console.warn(`[cache] invalidate failed for ${key}:`, error)
  }
}

export async function invalidateCachedPrefix(prefix: string): Promise<boolean> {
  try {
    await store.deletePrefix(prefix)
    return true
  } catch (error) {
    counters.errors += 1
    console.warn(`[cache] prefix invalidate failed for ${prefix}:`, error)
    return false
  }
}

export class CacheUnavailableError extends Error {
  constructor(key: string, cause: unknown) {
    super(`the shared cache could not be read for ${key}`, { cause })
    this.name = 'CacheUnavailableError'
  }
}

export async function getCachedOrRefuse<T>(key: string, ttlMs: number, loader: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
  let hit: string | null
  try {
    hit = await store.get(key)
  } catch (error) {
    counters.errors += 1
    throw new CacheUnavailableError(key, error)
  }
  if (hit !== null) {
    counters.hits += 1
    return JSON.parse(hit) as T
  }
  counters.misses += 1
  const value = await loader()
  if (!keep(value)) return value
  try {
    await store.set(key, JSON.stringify(value ?? null), ttlMs)
  } catch (error) {
    counters.errors += 1
    console.warn(`[cache] write failed for ${key}:`, error)
  }
  return value
}
