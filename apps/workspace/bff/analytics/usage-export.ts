/**
 * LLM spend and budget limits in PostHog (ADR-0100,
 * docs/observability/org-spend-in-posthog.md).
 *
 * The usage ledger (`llm_usage_events`) is the one record of what each
 * organization spent. Langfuse's export carries no organization and is not
 * reliable, and OpenRouter's warehouse source is the platform's own bill, so
 * neither can say what an office used. This sends the ledger itself, in three
 * streams, every ten minutes from the `usage-export` Hatchet task (`bff/scheduling/tasks.ts`):
 *
 * - **`llm_usage_hourly`**: one event per organization, closed UTC hour, model,
 *   activity, purpose, person, project and key, with the hour's calls, tokens,
 *   cost, price and credits, and `amount` in the organization's unit, the number
 *   its Budgets page shows. Hourly, not per call: the calls are thousands a day,
 *   the aggregates are a few hundred, and PostHog charts sum them the same way.
 * - **`llm_usage_by_outcome`**: the same ledger per closed UTC hour, grouped by
 *   the outcome its rows name instead of by person and project: the chat answer
 *   (`message_id`), the ingest job or run (`job_id`), the conversation, with the
 *   model and purpose. What one answer or one document cost, joined in PostHog
 *   to `answer_completed` and to `document_ingest_started` (which carries the
 *   job id) — the unit costs the hourly sums cannot give.
 * - **`organization_budget_snapshot`**: once an hour, per organization that spent
 *   lately or set a limit, its effective limits (the seeded allowance included),
 *   today's and this month's spend against them, and whether a budget blocks it.
 *   The limits are computed by the same functions the Budgets page calls, so
 *   PostHog never re-derives a business rule in SQL.
 *
 * **Each hour once.** PostHog cannot update an event and does not reliably drop
 * a repeated one at read time, so the export keeps a cursor per stream
 * (`analytics_export_cursors`, migration 0154). A run claims the stream, sends
 * the closed hours after the cursor, waits for PostHog to accept them and only
 * then moves the cursor. A run that fails leaves the cursor where it was and the
 * next run sends the same hours; the first run ever starts at the backfill
 * horizon, which is how the history arrives, a bounded window per run.
 *
 * An hour is closed `SETTLE_MS` after it ends: a ledger row is stamped when its
 * batch's transaction starts, so one written at :59 can commit a moment later.
 *
 * Personless and non-personal like every server event: ids of our own rows,
 * model ids, counts and amounts. With PostHog off it reads nothing.
 */

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

/** How long after an hour ends it counts as closed. */
export const SETTLE_MS = 10 * 60_000
/** How far back the first run reaches. The ledger's history before it stays out of PostHog. */
export const BACKFILL_DAYS = 90
/** Hours one run sends at most: the backfill arrives over several runs, never in one long one. */
export const MAX_HOURS_PER_RUN = 48
/** Events between two flushes; below the batch client's queue limit. */
const FLUSH_EVERY = 500
/** How long a run may hold a stream before another may take it. */
const LEASE_MS = 10 * 60_000
/** An organization that spent within this window gets a budget snapshot. */
const SNAPSHOT_ACTIVE_DAYS = 35

const PLATFORM_REASON = 'PostHog usage export: the ledger summed per organization and hour, and its cursor'

export const floorToHour = (date: Date): Date => new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS)

/**
 * The window a run sends: from the cursor to the last closed hour, at most
 * `MAX_HOURS_PER_RUN` hours. `null` when no hour has closed since the cursor.
 */
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

/** What the organization's Budgets page counts: credits, or tokens on its own key. */
const amountIn = (unit: BudgetUnit, row: Pick<UsageHourRow, 'credits' | 'totalTokens'>): number =>
  unit === 'token' ? row.totalTokens : round(row.credits, 6)

/** The properties of one `llm_usage_hourly` event. Pure, so the spec pins the contract. */
export function usageHourProperties(row: UsageHourRow, unit: BudgetUnit): ServerEventProperties {
  return {
    hour: row.hour.toISOString(),
    model: row.model,
    // A NULL activity is a chat answer or a scheduled run; the ledger names only the others.
    activity: row.activity ?? 'chat',
    // The backend's usage role (`rerank`, `ingest_vision`, …); NULL is an agent's own call.
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
    reasoning_tokens: row.reasoningTokens,
    total_tokens: row.totalTokens,
    credits: round(row.credits, 6),
    cost_usd: round(row.costUsd, 8),
    price_usd: round(row.priceUsd, 8),
    audio_seconds: row.audioSeconds > 0 ? round(row.audioSeconds, 2) : undefined,
  }
}

/** Send `events` in chunks, each flushed before the next; rejects on the first send PostHog refused. */
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
  /** Whether the cursor moved: there is more history behind it when `to` is not the last closed hour. */
  caughtUp: boolean
}

/**
 * What one answer, ingest job or run is, from the keys its ledger rows carry.
 * An answer wins over the job it ran in; an ingest job is named apart from the
 * other jobs because its cost is the one divided by pages and bytes.
 */
export function outcomeKind(row: Pick<UsageOutcomeRow, 'messageId' | 'jobId' | 'activity'>): string {
  if (row.messageId) return 'answer'
  if (row.jobId) return row.activity === 'ingest' ? 'ingest' : 'job'
  return 'conversation'
}

/** The properties of one `llm_usage_by_outcome` event. Pure, so the spec pins the contract. */
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
    reasoning_tokens: row.reasoningTokens,
    cost_usd: round(row.costUsd, 8),
    price_usd: round(row.priceUsd, 8),
  }
}

type ExportEvent = Parameters<PosthogBatch['capture']>[0]

/**
 * Send the closed hours after `stream`'s cursor: read them, turn them into
 * events, send, and only then move the cursor. `null` when another run holds
 * the stream or nothing closed. A failed read or send gives the stream back
 * unmoved, so the next run sends the same hours.
 */
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

/** The ledger per outcome (answer, ingest job, run) for the closed hours after its own cursor. */
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

/** Send the closed hours after the cursor. `null` when another run holds the stream or nothing closed. */
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

/** One organization's `organization_budget_snapshot` properties, read inside its own tenant scope. */
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

/** One snapshot per organization, once per UTC hour. `null` when this hour has one, or another run holds it. */
async function exportBudgetSnapshots(batch: PosthogBatch, now: Date): Promise<SnapshotStreamResult | null> {
  const stream = 'posthog_budget_snapshot'
  const hour = floorToHour(now)
  // A first run takes this hour: there is no history of limits to send.
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
  /** False when PostHog is not configured: nothing was read or sent. */
  enabled: boolean
  usage: UsageStreamResult | null
  outcomes: UsageStreamResult | null
  snapshot: SnapshotStreamResult | null
}

/**
 * One export run: the closed usage hours, then this hour's budget snapshots.
 * Throws when a send or a read failed, after giving the stream back unmoved,
 * so the `usage-export` task's run records the failure.
 */
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
