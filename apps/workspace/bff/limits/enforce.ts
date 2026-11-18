import 'server-only'
import { TooManyRequestsError } from '@/lib/api/errors'
import { getLimitStore } from './store'
import type { LimitRule, RateLimitDecision } from './types'

export async function consumeLimit(
  rule: LimitRule,
  subject: string,
  cost = 1,
): Promise<RateLimitDecision> {
  try {
    const outcome = await getLimitStore().consume(rule, subject, cost)
    return {
      allowed: outcome.allowed,
      rule: rule.name,
      remaining: outcome.remaining,
      limit: rule.limit,
      retryAfterSeconds: Math.ceil(outcome.retryAfterMs / 1000),
      degraded: outcome.degraded,
    }
  } catch (error) {
    console.warn(`[limits] ${rule.name} check failed for ${subject}, allowing:`, error)
    return {
      allowed: true,
      rule: rule.name,
      remaining: rule.limit,
      limit: rule.limit,
      retryAfterSeconds: 0,
      degraded: true,
    }
  }
}

export async function enforceLimit(
  rule: LimitRule,
  subject: string,
  cost = 1,
): Promise<RateLimitDecision> {
  const decision = await consumeLimit(rule, subject, cost)
  if (!decision.allowed) throw new TooManyRequestsError(decision)
  return decision
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Policy': decision.rule,
  }
  if (!decision.allowed) headers['Retry-After'] = String(Math.max(1, decision.retryAfterSeconds))
  return headers
}
