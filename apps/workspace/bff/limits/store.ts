import 'server-only'
import { createRedisClient } from '@/lib/redis/connect.js'
import { consumeLimiter, createLimiter } from './factory.js'
import type { LimitRule } from './types'

export interface StoreOutcome {
  readonly allowed: boolean
  readonly retryAfterMs: number
  readonly remaining: number
  readonly degraded: boolean
}

export interface LimitStore {
  consume(rule: LimitRule, subject: string, cost: number): Promise<StoreOutcome>
}

interface RedisLike {
  on(event: string, handler: (error: unknown) => void): void
}

class LimiterStore implements LimitStore {
  private readonly limiters = new Map<string, ReturnType<typeof createLimiter>>()

  constructor(private readonly client: RedisLike | null) {}

  async consume(rule: LimitRule, subject: string, cost: number): Promise<StoreOutcome> {
    let limiter = this.limiters.get(rule.name)
    if (!limiter) {
      limiter = createLimiter(rule, this.client)
      this.limiters.set(rule.name, limiter)
    }
    return consumeLimiter(limiter, subject, cost)
  }
}

function createClient(url: string): RedisLike {
  return createRedisClient(url, 'limits', { commandTimeout: 500 }) as RedisLike
}

function createDefaultStore(): LimitStore {
  const url = process.env.REDIS_URL
  if (url) {
    try {
      return new LimiterStore(createClient(url))
    } catch (error) {
      console.warn('[limits] redis store unavailable, using per-process buckets:', error)
    }
  }
  return new LimiterStore(null)
}

let store: LimitStore | null = null

export function getLimitStore(): LimitStore {
  if (!store) store = createDefaultStore()
  return store
}

export function setLimitStore(next: LimitStore | null): void {
  store = next
}

export function createInProcessStore(): LimitStore {
  return new LimiterStore(null)
}
