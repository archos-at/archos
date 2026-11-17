import type { BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'

export type UsageNoticeLevel = 'forecast' | 'warning' | 'critical' | 'exhausted'

export const USAGE_NOTICE_THRESHOLDS = [
  { level: 'exhausted', percent: 100 },
  { level: 'critical', percent: 95 },
  { level: 'warning', percent: 80 },
] as const satisfies ReadonlyArray<{ level: UsageNoticeLevel; percent: number }>

export const FORECAST_MIN_PERCENT = 50
const FORECAST_MIN_LEAD_MS = 24 * 60 * 60_000
const FORECAST_MIN_ELAPSED_MS = 60 * 60_000

const LEVEL_RANK: Record<UsageNoticeLevel, number> = { forecast: 0, warning: 1, critical: 2, exhausted: 3 }

export interface WindowUtilisation {
  scope: BudgetScope
  subjectId: string | null
  unit: BudgetUnit
  window: 'day' | 'month'
  limit: number
  used: number
}

export interface UsageNoticeDecision {
  level: UsageNoticeLevel
  scope: BudgetScope
  subjectId: string | null
  window: 'day' | 'month'
  unit: BudgetUnit
  percent: number
  used: number
  limit: number
  windowId: string
  resetsAt: string
  runsOutAt: string | null
}

export const utcWindow = (window: 'day' | 'month', now: Date): { id: string; startsAt: number; endsAt: number } => {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  if (window === 'month') {
    return { id: now.toISOString().slice(0, 7), startsAt: Date.UTC(year, month, 1), endsAt: Date.UTC(year, month + 1, 1) }
  }
  const day = now.getUTCDate()
  return {
    id: now.toISOString().slice(0, 10),
    startsAt: Date.UTC(year, month, day),
    endsAt: Date.UTC(year, month, day + 1),
  }
}

const percentUsed = (used: number, limit: number): number => (limit > 0 ? (used / limit) * 100 : 100)

export const projectedRunOut = (usage: WindowUtilisation, now: Date): Date | null => {
  if (usage.window !== 'month' || usage.limit <= 0 || usage.used >= usage.limit) return null
  if (percentUsed(usage.used, usage.limit) < FORECAST_MIN_PERCENT) return null
  const { startsAt, endsAt } = utcWindow('month', now)
  const elapsed = now.getTime() - startsAt
  if (elapsed < FORECAST_MIN_ELAPSED_MS) return null
  const runsOutAt = startsAt + elapsed * (usage.limit / usage.used)
  return runsOutAt <= endsAt - FORECAST_MIN_LEAD_MS ? new Date(runsOutAt) : null
}

const levelOf = (usage: WindowUtilisation, runsOutAt: Date | null): UsageNoticeLevel | null => {
  const percent = percentUsed(usage.used, usage.limit)
  const crossed = USAGE_NOTICE_THRESHOLDS.find((threshold) => percent >= threshold.percent)
  if (crossed) return crossed.level
  return runsOutAt ? 'forecast' : null
}

const outranks = (a: UsageNoticeDecision, b: UsageNoticeDecision): boolean => {
  if (LEVEL_RANK[a.level] !== LEVEL_RANK[b.level]) return LEVEL_RANK[a.level] > LEVEL_RANK[b.level]
  if (a.level === 'exhausted' && a.resetsAt !== b.resetsAt) return a.resetsAt > b.resetsAt
  if (a.level === 'forecast' && a.runsOutAt && b.runsOutAt && a.runsOutAt !== b.runsOutAt) {
    return a.runsOutAt < b.runsOutAt
  }
  return percentUsed(a.used, a.limit) > percentUsed(b.used, b.limit)
}

export function decideUsageNotice(usages: readonly WindowUtilisation[], now: Date): UsageNoticeDecision | null {
  let best: UsageNoticeDecision | null = null
  for (const usage of usages) {
    const runsOutAt = projectedRunOut(usage, now)
    const level = levelOf(usage, runsOutAt)
    if (!level) continue
    const window = utcWindow(usage.window, now)
    const candidate: UsageNoticeDecision = {
      level,
      scope: usage.scope,
      subjectId: usage.subjectId,
      window: usage.window,
      unit: usage.unit,
      percent: Math.min(100, Math.floor(percentUsed(usage.used, usage.limit))),
      used: usage.used,
      limit: usage.limit,
      windowId: window.id,
      resetsAt: new Date(window.endsAt).toISOString(),
      runsOutAt: runsOutAt?.toISOString() ?? null,
    }
    if (!best || outranks(candidate, best)) best = candidate
  }
  return best
}

export interface ChatUsageNotice {
  level: UsageNoticeLevel
  scope: BudgetScope
  window: 'day' | 'month'
  unit: BudgetUnit
  percent: number
  amounts: { used: number; limit: number } | null
  resetsAt: string
  runsOutAt: string | null
  canChange: boolean
  href: string
  key: string
}
