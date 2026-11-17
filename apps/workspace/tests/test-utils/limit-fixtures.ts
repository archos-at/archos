import type { LimitRule, RateLimitDecision } from '@/lib/limits'

export function allowedDecision(rule: LimitRule, remaining = rule.limit - 1): RateLimitDecision {
  return {
    allowed: true,
    rule: rule.name,
    remaining,
    limit: rule.limit,
    retryAfterSeconds: 0,
    degraded: false,
  }
}

export function refusedDecision(rule: LimitRule, retryAfterSeconds = 30): RateLimitDecision {
  return {
    allowed: false,
    rule: rule.name,
    remaining: 0,
    limit: rule.limit,
    retryAfterSeconds,
    degraded: false,
  }
}

export function degradedDecision(rule: LimitRule): RateLimitDecision {
  return {
    allowed: true,
    rule: rule.name,
    remaining: rule.limit,
    limit: rule.limit,
    retryAfterSeconds: 0,
    degraded: true,
  }
}
