/**
 * The reads and the bookkeeping behind the PostHog usage export
 * (`usage-export.ts`): the cursor per stream, the ledger summed per hour, and
 * the organizations worth a budget snapshot. Raw data access only (ADR-0017).
 *
 * Every function here reads across tenants or writes a platform table, so each
 * runs inside the caller's `withPlatformAccess` scope; the exporter is the only
 * caller.
 */

import 'server-only'
import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { analyticsExportCursors, type AnalyticsExportStream } from '@/lib/db/schema/analytics-export-cursors'
import { budgetPolicies, llmUsageEvents, llmUsageRollups, type UsageActivity } from '@/lib/db/schema/budgets'

/**
 * Take the stream for `leaseMs`, or `null` when another run holds it. A stream
 * with no row yet is created at `initialThrough`, which is where its first run
 * starts (the backfill horizon). Returns where this run starts.
 */
export async function claimCursor(
  stream: AnalyticsExportStream,
  initialThrough: Date,
  leaseMs: number,
  now: Date,
): Promise<Date | null> {
  const db = getDb()
  const leaseUntil = new Date(now.getTime() + leaseMs)
  await db
    .insert(analyticsExportCursors)
    .values({ stream, exportedThrough: initialThrough })
    .onConflictDoNothing({ target: analyticsExportCursors.stream })
  const [claimed] = await db
    .update(analyticsExportCursors)
    .set({ leaseUntil, updatedAt: now })
    .where(
      and(
        eq(analyticsExportCursors.stream, stream),
        or(isNull(analyticsExportCursors.leaseUntil), lt(analyticsExportCursors.leaseUntil, now)),
      ),
    )
    .returning({ exportedThrough: analyticsExportCursors.exportedThrough })
  return claimed ? new Date(claimed.exportedThrough) : null
}

/** Move the stream on to `through` and let it go. */
export async function advanceCursor(stream: AnalyticsExportStream, through: Date, now: Date): Promise<void> {
  await getDb()
    .update(analyticsExportCursors)
    .set({ exportedThrough: through, leaseUntil: null, updatedAt: now })
    .where(eq(analyticsExportCursors.stream, stream))
}

/** Let the stream go without moving it: the next run sends the same hours again. */
export async function releaseCursor(stream: AnalyticsExportStream, now: Date): Promise<void> {
  await getDb()
    .update(analyticsExportCursors)
    .set({ leaseUntil: null, updatedAt: now })
    .where(eq(analyticsExportCursors.stream, stream))
}

/** One organization's spend in one hour on one model, for one person, project and purpose. */
export interface UsageHourRow {
  organizationId: string
  /** Start of the UTC hour. */
  hour: Date
  model: string
  activity: UsageActivity | null
  agentGroup: string | null
  userId: string | null
  projectId: string | null
  ownKey: boolean
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  priceUsd: number
  credits: number
  audioSeconds: number
}

const num = (value: unknown): number => Number.parseFloat(String(value ?? '0')) || 0

/**
 * The ledger in `[from, to)`, summed per organization, UTC hour, model,
 * activity, purpose, person, project and key. Bounded by the window the
 * exporter passes, never by a row limit: a cut-off group would send a wrong
 * hour that the cursor then marks as sent.
 */
export async function sumUsageByHour(from: Date, to: Date): Promise<UsageHourRow[]> {
  const db = getDb()
  const hour = sql<string>`date_trunc('hour', ${llmUsageEvents.createdAt})`
  const model = sql<string>`coalesce(${llmUsageEvents.model}, 'unknown')`
  const ownKey = sql<boolean>`coalesce(${llmUsageEvents.isByok}, false)`
  const rows = await db
    .select({
      organizationId: llmUsageEvents.organizationId,
      hour,
      model,
      activity: llmUsageEvents.activity,
      agentGroup: llmUsageEvents.agentGroup,
      userId: llmUsageEvents.userId,
      projectId: llmUsageEvents.projectId,
      ownKey,
      calls: sql<string>`count(*)`,
      promptTokens: sql<string>`coalesce(sum(${llmUsageEvents.promptTokens}), 0)`,
      completionTokens: sql<string>`coalesce(sum(${llmUsageEvents.completionTokens}), 0)`,
      cachedTokens: sql<string>`coalesce(sum(${llmUsageEvents.cachedTokens}), 0)`,
      cacheWriteTokens: sql<string>`coalesce(sum(${llmUsageEvents.cacheWriteTokens}), 0)`,
      reasoningTokens: sql<string>`coalesce(sum(${llmUsageEvents.reasoningTokens}), 0)`,
      totalTokens: sql<string>`coalesce(sum(${llmUsageEvents.totalTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}), 0)`,
      priceUsd: sql<string>`coalesce(sum(${llmUsageEvents.priceUsd}), 0)`,
      credits: sql<string>`coalesce(sum(${llmUsageEvents.credits}), 0)`,
      audioSeconds: sql<string>`coalesce(sum(${llmUsageEvents.audioSeconds}), 0)`,
    })
    .from(llmUsageEvents)
    .where(and(gte(llmUsageEvents.createdAt, from), lt(llmUsageEvents.createdAt, to)))
    .groupBy(
      llmUsageEvents.organizationId,
      hour,
      model,
      llmUsageEvents.activity,
      llmUsageEvents.agentGroup,
      llmUsageEvents.userId,
      llmUsageEvents.projectId,
      ownKey,
    )

  // Coerce at the boundary: raw `sql<T>` columns arrive as strings.
  return rows.map((row) => ({
    organizationId: row.organizationId,
    hour: new Date(row.hour),
    model: row.model,
    activity: row.activity ?? null,
    agentGroup: row.agentGroup ?? null,
    userId: row.userId ?? null,
    projectId: row.projectId ?? null,
    ownKey: row.ownKey === true || String(row.ownKey) === 'true',
    calls: num(row.calls),
    promptTokens: num(row.promptTokens),
    completionTokens: num(row.completionTokens),
    cachedTokens: num(row.cachedTokens),
    cacheWriteTokens: num(row.cacheWriteTokens),
    reasoningTokens: num(row.reasoningTokens),
    totalTokens: num(row.totalTokens),
    costUsd: num(row.costUsd),
    priceUsd: num(row.priceUsd),
    credits: num(row.credits),
    audioSeconds: num(row.audioSeconds),
  }))
}

/** One outcome's spend in one hour on one model and purpose: an answer, an ingest job, a run. */
export interface UsageOutcomeRow {
  organizationId: string
  /** Start of the UTC hour. */
  hour: Date
  /** The chat answer the calls belong to (migration 0098); NULL for jobs and older rows. */
  messageId: string | null
  /** The ingest job or research run the calls ran in. */
  jobId: string | null
  conversationId: string | null
  model: string
  activity: UsageActivity | null
  agentGroup: string | null
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  costUsd: number
  priceUsd: number
  /**
   * The prompt and cached tokens of the answer's FIRST agent call, on the one
   * row that holds it (0 elsewhere). Its cached share is how much of the
   * conversation's prefix carried over from the previous turn: every later call
   * of a turn re-reads its own predecessor, so only the first one says whether
   * the conversation, rather than the turn, stayed warm.
   */
  firstCallPromptTokens: number
  firstCallCachedTokens: number
  /**
   * When the group's first and last agent calls ran (NULL for a group with none):
   * the gap from one answer's last call to the next one's first is how long the
   * provider had to keep the conversation's prefix, which bounds the carry.
   */
  firstAgentCallAt: Date | null
  lastAgentCallAt: Date | null
}

/**
 * Whether a ledger row is its answer's first agent call: the earliest row of
 * its organization and message with no usage role. Indexed by
 * `idx_llm_usage_events_org_message`.
 */
const isFirstAgentCall = sql`(
  ${llmUsageEvents.messageId} IS NOT NULL
  AND ${llmUsageEvents.agentGroup} IS NULL
  AND ${llmUsageEvents.createdAt} = (
    SELECT min(first_call.created_at) FROM llm_usage_events AS first_call
    WHERE first_call.organization_id = ${llmUsageEvents.organizationId}
      AND first_call.message_id = ${llmUsageEvents.messageId}
      AND first_call.agent_group IS NULL
  )
)`

/**
 * The ledger in `[from, to)` summed per organization, UTC hour, outcome key
 * (message, job, conversation), model, activity and purpose: what one answer or
 * one ingest cost, which `sumUsageByHour` sums away. Rows with none of the three
 * keys are left out; the hourly stream already carries them. Bounded by the
 * window like `sumUsageByHour`, never by a row limit.
 */
export async function sumUsageByOutcome(from: Date, to: Date): Promise<UsageOutcomeRow[]> {
  const db = getDb()
  const hour = sql<string>`date_trunc('hour', ${llmUsageEvents.createdAt})`
  const model = sql<string>`coalesce(${llmUsageEvents.model}, 'unknown')`
  const rows = await db
    .select({
      organizationId: llmUsageEvents.organizationId,
      hour,
      messageId: llmUsageEvents.messageId,
      jobId: llmUsageEvents.jobId,
      conversationId: llmUsageEvents.conversationId,
      model,
      activity: llmUsageEvents.activity,
      agentGroup: llmUsageEvents.agentGroup,
      calls: sql<string>`count(*)`,
      promptTokens: sql<string>`coalesce(sum(${llmUsageEvents.promptTokens}), 0)`,
      completionTokens: sql<string>`coalesce(sum(${llmUsageEvents.completionTokens}), 0)`,
      cachedTokens: sql<string>`coalesce(sum(${llmUsageEvents.cachedTokens}), 0)`,
      cacheWriteTokens: sql<string>`coalesce(sum(${llmUsageEvents.cacheWriteTokens}), 0)`,
      reasoningTokens: sql<string>`coalesce(sum(${llmUsageEvents.reasoningTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${llmUsageEvents.costUsd}), 0)`,
      priceUsd: sql<string>`coalesce(sum(${llmUsageEvents.priceUsd}), 0)`,
      firstCallPromptTokens: sql<string>`coalesce(sum(${llmUsageEvents.promptTokens}) FILTER (WHERE ${isFirstAgentCall}), 0)`,
      firstCallCachedTokens: sql<string>`coalesce(sum(${llmUsageEvents.cachedTokens}) FILTER (WHERE ${isFirstAgentCall}), 0)`,
      firstAgentCallAt: sql<string | null>`min(${llmUsageEvents.createdAt}) FILTER (WHERE ${llmUsageEvents.agentGroup} IS NULL)`,
      lastAgentCallAt: sql<string | null>`max(${llmUsageEvents.createdAt}) FILTER (WHERE ${llmUsageEvents.agentGroup} IS NULL)`,
    })
    .from(llmUsageEvents)
    .where(
      and(
        gte(llmUsageEvents.createdAt, from),
        lt(llmUsageEvents.createdAt, to),
        sql`(${llmUsageEvents.messageId} IS NOT NULL OR ${llmUsageEvents.jobId} IS NOT NULL OR ${llmUsageEvents.conversationId} IS NOT NULL)`,
      ),
    )
    .groupBy(
      llmUsageEvents.organizationId,
      hour,
      llmUsageEvents.messageId,
      llmUsageEvents.jobId,
      llmUsageEvents.conversationId,
      model,
      llmUsageEvents.activity,
      llmUsageEvents.agentGroup,
    )

  return rows.map((row) => ({
    organizationId: row.organizationId,
    hour: new Date(row.hour),
    messageId: row.messageId ?? null,
    jobId: row.jobId ?? null,
    conversationId: row.conversationId ?? null,
    model: row.model,
    activity: row.activity ?? null,
    agentGroup: row.agentGroup ?? null,
    calls: num(row.calls),
    promptTokens: num(row.promptTokens),
    completionTokens: num(row.completionTokens),
    cachedTokens: num(row.cachedTokens),
    cacheWriteTokens: num(row.cacheWriteTokens),
    reasoningTokens: num(row.reasoningTokens),
    costUsd: num(row.costUsd),
    priceUsd: num(row.priceUsd),
    firstCallPromptTokens: num(row.firstCallPromptTokens),
    firstCallCachedTokens: num(row.firstCallCachedTokens),
    firstAgentCallAt: row.firstAgentCallAt ? new Date(row.firstAgentCallAt) : null,
    lastAgentCallAt: row.lastAgentCallAt ? new Date(row.lastAgentCallAt) : null,
  }))
}

/**
 * The organizations a budget snapshot is worth sending for: every one that
 * spent since `since`, and every one with an explicit organization limit. An
 * organization that never spent and never set a limit runs on the seeded
 * allowance, which the snapshot of any other organization already shows.
 */
export async function listSnapshotOrganizations(since: Date): Promise<string[]> {
  const db = getDb()
  const sinceDay = since.toISOString().slice(0, 10)
  const [spent, limited] = await Promise.all([
    db
      .selectDistinct({ organizationId: llmUsageRollups.organizationId })
      .from(llmUsageRollups)
      .where(gte(llmUsageRollups.day, sinceDay)),
    db
      .selectDistinct({ organizationId: budgetPolicies.organizationId })
      .from(budgetPolicies)
      .where(and(eq(budgetPolicies.scope, 'organization'), eq(budgetPolicies.status, 'active'))),
  ])
  return [...new Set([...spent, ...limited].map((row) => row.organizationId))].sort()
}
