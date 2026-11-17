export interface LimitBudget {
  readonly limit: number
  readonly windowMs: number
}

export interface LimitRule extends LimitBudget {
  readonly name: string
  readonly burst?: LimitBudget
}

export interface RateLimitDecision {
  readonly allowed: boolean
  readonly rule: string
  readonly remaining: number
  readonly limit: number
  readonly retryAfterSeconds: number
  readonly degraded: boolean
}
