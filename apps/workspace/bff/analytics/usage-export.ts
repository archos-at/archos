import 'server-only'

import {
  getBudgetStatus,
  getOrgBudget,
  getOrgBudgetUnit,
  getSpendSummary,
  listActivePolicies,
} from '@/lib/budgets/service'
import type { AnalyticsExportStream } from '@/lib/db/schema/analytics-export-cursors'
import { UNBILLED_USAGE_ACTIVITIES, type BudgetUnit } from '@/lib/db/schema/budgets'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { createPosthogBatch, type PosthogBatch, type ServerEventProperties } from './posthog-server'
import {
  advanceCursor,
  claimCursor,
  listSnapshotOrganizations,
  releaseCursor,
  sumUsageByHour,
  sumUsageByOutcome,
  type UsageHourRow,
  type UsageOutcomeRow,
} from './usage-export-repository'

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

export const SETTLE_MS = 10 * 60_000
export const BACKFILL_DAYS = 90
export const MAX_HOURS_PER_RUN = 48
const FLUSH_EVERY = 500
const LEASE_MS = 10 * 60_000
const SNAPSHOT_ACTIVE_DAYS = 35

const PLATFORM_REASON = 'PostHog usage export: the ledger summed per organization and hour, and its cursor'

export const floorToHour = (date: Date): Date => new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS)

export function exportWindow(cursor: Date, now: Date): { from: Date; to: Date } | null {
  const lastClosed = floorToHour(new Date(now.getTime() - SETTLE_MS))
  const from = floorToHour(cursor)
  const to = new Date(Math.min(lastClosed.getTime(), from.getTime() + MAX_HOURS_PER_RUN * HOUR_MS))
  return to.getTime() > from.getTime() ? { from, to } : null
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const amountIn = (unit: BudgetUnit, row: Pick<UsageHourRow, 'credits' | 'totalTokens'>): number =>
  unit === 'token' ? row.totalTokens : round(row.credits, 6)

export function usageHourProperties(row: UsageHourRow, unit: BudgetUnit): ServerEventProperties {
  return {
    hour: row.hour.toISOString(),
    model: row.model,
    activity: row.activity ?? 'chat',
    purpose: row.agentGroup ?? 'agent',
    user_id: row.userId ?? undefined,
    project_id: row.projectId ?? undefined,
    own_key: row.ownKey,
    billed: !(row.activity && UNBILLED_USAGE_ACTIVITIES.has(row.activity)),
    unit,
    amount: amountIn(unit, row),
    calls: row.calls,
    prompt_tokens: row.promptTokens,
    completion_tokens: row.completionTokens,
    cached_tokens: row.cachedTokens,
    cache_write_tokens: row.cacheWriteTokens,
    reasoning_tokens: row.reasoningTokens,
    total_tokens: row.totalTokens,
    credits: round(row.credits, 6),
    cost_usd: round(row.costUsd, 8),
    price_usd: round(row.priceUsd, 8),
    audio_seconds: row.audioSeconds > 0 ? round(row.audioSeconds, 2) : undefined,
  }
}

async function sendAll(
  batch: PosthogBatch,
  events: Array<Parameters<PosthogBatch['capture']>[0]>,
): Promise<void> {
  for (let index = 0; index < events.length; index += FLUSH_EVERY) {
    for (const event of events.slice(index, index + FLUSH_EVERY)) batch.capture(event)
    await batch.flush()
  }
}

export interface UsageStreamResult {
  from: string
  to: string
  rows: number
  caughtUp: boolean
}

export function outcomeKind(row: Pick<UsageOutcomeRow, 'messageId' | 'jobId' | 'activity'>): string {
  if (row.messageId) return 'answer'
  if (row.jobId) return row.activity === 'ingest' ? 'ingest' : 'job'
  return 'conversation'
}

export function usageOutcomeProperties(row: UsageOutcomeRow): ServerEventProperties {
  return {
    hour: row.hour.toISOString(),
    outcome: outcomeKind(row),
    message_id: row.messageId ?? undefined,
    job_id: row.jobId ?? undefined,
    conversation_id: row.conversationId ?? undefined,
    model: row.model,
    activity: row.activity ?? 'chat',
    purpose: row.agentGroup ?? 'agent',
    calls: row.calls,
    prompt_tokens: row.promptTokens,
    completion_tokens: row.completionTokens,
    cached_tokens: row.cachedTokens,
    cache_write_tokens: row.cacheWriteTokens,
    reasoning_tokens: row.reasoningTokens,
    cost_usd: round(row.costUsd, 8),
    price_usd: round(row.priceUsd, 8),
    first_call_prompt_tokens: row.firstCallPromptTokens > 0 ? row.firstCallPromptTokens : undefined,
    first_call_cached_tokens: row.firstCallPromptTokens > 0 ? row.firstCallCachedTokens : undefined,
    first_agent_call_at: row.firstAgentCallAt?.toISOString(),
    last_agent_call_at: row.lastAgentCallAt?.toISOString(),
  }
}

type ExportEvent = Parameters<PosthogBatch['capture']>[0]

async function exportClosedHours(
  batch: PosthogBatch,
  now: Date,
  stream: AnalyticsExportStream,
  eventsFor: (window: { from: Date; to: Date }) => Promise<ExportEvent[]>,
): Promise<UsageStreamResult | null> {
  const horizon = floorToHour(new Date(now.getTime() - BACKFILL_DAYS * DAY_MS))
  const cursor = await withPlatformAccess(PLATFORM_REASON, () => claimCursor(stream, horizon, LEASE_MS, now))
  if (!cursor) return null

  const window = exportWindow(cursor, now)
  if (!window) {
    await withPlatformAccess(PLATFORM_REASON, () => releaseCursor(stream, now))
    return null
  }

  try {
    const events = await eventsFor(window)
    await sendAll(batch, events)
    await withPlatformAccess(PLATFORM_REASON, () => advanceCursor(stream, window.to, now))
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      rows: events.length,
      caughtUp: exportWindow(window.to, now) === null,
    }
  } catch (error) {
    await withPlatformAccess(PLATFORM_REASON, () => releaseCursor(stream, now)).catch(() => undefined)
    throw error
  }
}

function exportUsageByOutcome(batch: PosthogBatch, now: Date): Promise<UsageStreamResult | null> {
  return exportClosedHours(batch, now, 'posthog_usage_by_outcome', async (window) => {
    const rows = await withPlatformAccess(PLATFORM_REASON, () => sumUsageByOutcome(window.from, window.to))
    return rows.map((row) => ({
      event: 'llm_usage_by_outcome' as const,
      distinctId: null,
      organizationId: row.organizationId,
      timestamp: row.hour,
      properties: usageOutcomeProperties(row),
    }))
  })
}

function exportUsageHours(batch: PosthogBatch, now: Date): Promise<UsageStreamResult | null> {
  return exportClosedHours(batch, now, 'posthog_usage_hourly', async (window) => {
    const rows = await withPlatformAccess(PLATFORM_REASON, () => sumUsageByHour(window.from, window.to))
    const units = new Map<string, BudgetUnit>()
    for (const organizationId of new Set(rows.map((row) => row.organizationId))) {
      units.set(organizationId, await withTenant({ organizationId }, () => getOrgBudgetUnit(organizationId)))
    }
    return rows.map((row) => ({
      event: 'llm_usage_hourly' as const,
      distinctId: null,
      organizationId: row.organizationId,
      timestamp: row.hour,
      properties: usageHourProperties(row, units.get(row.organizationId) ?? 'credit'),
    }))
  })
}

const percentOf = (used: number, limit: number | null): number | undefined =>
  limit === null ? undefined : limit > 0 ? round((used / limit) * 100, 1) : 100

async function budgetSnapshot(organizationId: string): Promise<ServerEventProperties> {
  return withTenant({ organizationId }, async () => {
    const unit = await getOrgBudgetUnit(organizationId)
    const [budget, summary, status, policies, name] = await Promise.all([
      getOrgBudget(organizationId, unit),
      getSpendSummary(organizationId),
      getBudgetStatus(organizationId, null, null),
      listActivePolicies(organizationId, unit),
      getOrganizationDisplayName(organizationId),
    ])
    const day = unit === 'token' ? summary.day.tokens : summary.day.credits
    const month = unit === 'token' ? summary.month.tokens : summary.month.credits
    return {
      organization_name: name ?? undefined,
      unit,
      daily_limit: budget.dailyLimit,
      monthly_limit: budget.monthlyLimit,
      limits_explicit: budget.explicit,
      day_amount: round(day, 6),
      month_amount: round(month, 6),
      day_pct: percentOf(day, budget.dailyLimit),
      month_pct: percentOf(month, budget.monthlyLimit),
      blocked: status.blocked,
      blocked_scope: status.blockedScope ?? undefined,
      member_limits: policies.filter((policy) => policy.scope === 'member').length,
      project_limits: policies.filter((policy) => policy.scope === 'project').length,
      month_calls: summary.month.events,
      month_tokens: summary.month.tokens,
      month_credits: round(summary.month.credits, 6),
      month_cost_usd: round(summary.month.costUsd, 8),
      month_price_usd: round(summary.month.priceUsd, 8),
    }
  })
}

export interface SnapshotStreamResult {
  hour: string
  organizations: number
}

async function exportBudgetSnapshots(batch: PosthogBatch, now: Date): Promise<SnapshotStreamResult | null> {
  const stream = 'posthog_budget_snapshot'
  const hour = floorToHour(now)
  const initial = new Date(hour.getTime() - HOUR_MS)
  const cursor = await withPlatformAccess(PLATFORM_REASON, () => claimCursor(stream, initial, LEASE_MS, now))
  if (!cursor) return null
  if (cursor.getTime() >= hour.getTime()) {
    await withPlatformAccess(PLATFORM_REASON, () => releaseCursor(stream, now))
    return null
  }

  try {
    const since = new Date(now.getTime() - SNAPSHOT_ACTIVE_DAYS * DAY_MS)
    const organizations = await withPlatformAccess(PLATFORM_REASON, () => listSnapshotOrganizations(since))
    const events = []
    for (const organizationId of organizations) {
      events.push({
        event: 'organization_budget_snapshot' as const,
        distinctId: null,
        organizationId,
        timestamp: now,
        properties: await budgetSnapshot(organizationId),
      })
    }
    await sendAll(batch, events)
    await withPlatformAccess(PLATFORM_REASON, () => advanceCursor(stream, hour, now))
    return { hour: hour.toISOString(), organizations: organizations.length }
  } catch (error) {
    await withPlatformAccess(PLATFORM_REASON, () => releaseCursor(stream, now)).catch(() => undefined)
    throw error
  }
}

export interface UsageExportResult {
  enabled: boolean
  usage: UsageStreamResult | null
  outcomes: UsageStreamResult | null
  snapshot: SnapshotStreamResult | null
}

export async function exportUsageToPosthog(now = new Date()): Promise<UsageExportResult> {
  const batch = createPosthogBatch()
  if (!batch) return { enabled: false, usage: null, outcomes: null, snapshot: null }
  try {
    const usage = await exportUsageHours(batch, now)
    const outcomes = await exportUsageByOutcome(batch, now)
    const snapshot = await exportBudgetSnapshots(batch, now)
    return { enabled: true, usage, outcomes, snapshot }
  } finally {
    await batch.close()
  }
}
