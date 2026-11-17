import 'server-only'
import { and, asc, desc, eq, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { bffJobQueue, type BffJobPriority, type BffJobRow } from '@/lib/db/schema/bff-job-queue'
import { KEPT_PAYLOAD_KEYS } from '../../workers/job-queue.js'

export async function insertJob(
  job: {
    kind: string
    organizationId: string
    priority: BffJobPriority
    payload: Record<string, unknown>
    jobId?: string
    notBefore?: Date
  },
  executor: DbExecutor = getDb()
): Promise<string> {
  const [row] = await executor
    .insert(bffJobQueue)
    .values({
      ...(job.jobId ? { jobId: job.jobId } : {}),
      kind: job.kind,
      lane: job.organizationId,
      priority: job.priority,
      payload: job.payload,
      notBefore: job.notBefore ?? null,
    })
    .returning({ jobId: bffJobQueue.jobId })
  return row.jobId
}

export async function insertJobIfAbsent(
  job: {
    kind: string
    organizationId: string
    priority: BffJobPriority
    payload: Record<string, unknown>
    jobId: string
    notBefore?: Date
  },
  executor: DbExecutor = getDb()
): Promise<boolean> {
  const rows = await executor
    .insert(bffJobQueue)
    .values({
      jobId: job.jobId,
      kind: job.kind,
      lane: job.organizationId,
      priority: job.priority,
      payload: job.payload,
      notBefore: job.notBefore ?? null,
    })
    .onConflictDoNothing()
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length > 0
}

export async function deleteQueuedJob(jobId: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .delete(bffJobQueue)
    .where(and(eq(bffJobQueue.jobId, jobId), eq(bffJobQueue.status, 'queued')))
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length > 0
}

export async function findOpenJobId(query: {
  kind: string
  organizationId: string
  matching: Record<string, unknown>
  notStarted?: boolean
}): Promise<string | null> {
  const db = getDb()
  const [row] = await db
    .select({ jobId: bffJobQueue.jobId })
    .from(bffJobQueue)
    .where(
      and(
        matchingJobs(query),
        query.notStarted ? eq(bffJobQueue.status, 'queued') : ne(bffJobQueue.status, 'dead')
      )
    )
    .orderBy(asc(bffJobQueue.createdAt))
    .limit(1)
  return row?.jobId ?? null
}

export async function findDeadJob(query: {
  kind: string
  organizationId: string
  matching: Record<string, unknown>
}): Promise<{ jobId: string; lastError: string | null } | null> {
  const db = getDb()
  const [row] = await db
    .select({ jobId: bffJobQueue.jobId, lastError: bffJobQueue.lastError })
    .from(bffJobQueue)
    .where(and(matchingJobs(query), eq(bffJobQueue.status, 'dead')))
    .orderBy(desc(bffJobQueue.createdAt))
    .limit(1)
  return row ?? null
}

function matchingJobs(query: { kind: string; organizationId: string; matching: Record<string, unknown> }) {
  return and(
    eq(bffJobQueue.kind, query.kind),
    eq(bffJobQueue.lane, query.organizationId),
    sql`${bffJobQueue.payload} @> ${JSON.stringify(query.matching)}::text::jsonb`
  )
}

const MAX_ERROR_CHARS = 2000

const EARLY_TOLERANCE_SECONDS = 30

const scrubbedPayload = sql`(
  SELECT COALESCE(jsonb_object_agg(kept.key, kept.value), '{}'::jsonb)
  FROM jsonb_each(CASE WHEN jsonb_typeof(${bffJobQueue.payload}) = 'object' THEN ${bffJobQueue.payload} ELSE '{}'::jsonb END) AS kept
  WHERE kept.key = ANY(string_to_array(${KEPT_PAYLOAD_KEYS.join(',')}, ','))
)`

const describeError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS)

const heldBy = (jobId: string, holder: string) =>
  and(eq(bffJobQueue.jobId, jobId), eq(bffJobQueue.claimedBy, holder), eq(bffJobQueue.status, 'claimed'))

const lastAlive = sql`coalesce(greatest(${bffJobQueue.heartbeatAt}, ${bffJobQueue.claimedAt}), ${bffJobQueue.createdAt})`

const silentClaim = (staleSeconds: number) =>
  and(eq(bffJobQueue.status, 'claimed'), lt(lastAlive, sql`now() - make_interval(secs => ${staleSeconds})`))

export async function takeJob(jobId: string, holder: string, options: { staleSeconds: number }): Promise<BffJobRow | null> {
  const [row] = await getDb()
    .update(bffJobQueue)
    .set({ status: 'claimed', claimedBy: holder, claimedAt: sql`now()`, heartbeatAt: sql`now()`, attempts: sql`${bffJobQueue.attempts} + 1` })
    .where(
      and(
        eq(bffJobQueue.jobId, jobId),
        or(
          and(
            eq(bffJobQueue.status, 'queued'),
            or(isNull(bffJobQueue.notBefore), lte(bffJobQueue.notBefore, sql`now() + make_interval(secs => ${EARLY_TOLERANCE_SECONDS})`))
          ),
          silentClaim(options.staleSeconds)
        )
      )
    )
    .returning()
  return row ?? null
}

export async function jobExists(jobId: string): Promise<boolean> {
  const rows = await getDb().select({ jobId: bffJobQueue.jobId }).from(bffJobQueue).where(eq(bffJobQueue.jobId, jobId)).limit(1)
  return rows.length > 0
}

export async function heartbeatJob(jobId: string, holder: string): Promise<boolean> {
  const rows = await getDb()
    .update(bffJobQueue)
    .set({ heartbeatAt: sql`now()` })
    .where(heldBy(jobId, holder))
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length > 0
}

export async function releaseJobs(held: ReadonlyArray<{ jobId: string; holder: string }>): Promise<number> {
  if (held.length === 0) return 0
  const rows = await getDb()
    .update(bffJobQueue)
    .set({ status: 'queued', claimedBy: null, heartbeatAt: null })
    .where(or(...held.map(({ jobId, holder }) => heldBy(jobId, holder))))
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length
}

export async function finishJob(jobId: string, holder: string): Promise<boolean> {
  const rows = await getDb().delete(bffJobQueue).where(heldBy(jobId, holder)).returning({ jobId: bffJobQueue.jobId })
  return rows.length > 0
}

export async function saveJobProgress(
  jobId: string,
  holder: string,
  payload: object,
  notBefore: Date | null
): Promise<{ claimedAt: Date | null } | null> {
  const [row] = await getDb()
    .update(bffJobQueue)
    .set({
      status: 'queued',
      payload: sql`${JSON.stringify(payload)}::text::jsonb`,
      notBefore,
      attempts: 0,
      claimedBy: null,
      heartbeatAt: null,
    })
    .where(heldBy(jobId, holder))
    .returning({ claimedAt: bffJobQueue.claimedAt })
  return row ? { claimedAt: row.claimedAt ? new Date(row.claimedAt) : null } : null
}

export async function failJob(
  jobId: string,
  holder: string,
  error: unknown,
  options: { maxAttempts: number; retryInSeconds: number }
): Promise<'queued' | 'dead' | null> {
  const last = sql`${bffJobQueue.attempts} >= ${options.maxAttempts}`
  const [row] = await getDb()
    .update(bffJobQueue)
    .set({
      status: sql`CASE WHEN ${last} THEN 'dead' ELSE 'queued' END`,
      deadAt: sql`CASE WHEN ${last} THEN now() END`,
      payload: sql`CASE WHEN ${last} THEN ${scrubbedPayload} ELSE ${bffJobQueue.payload} END`,
      notBefore: sql`CASE WHEN ${last} THEN NULL ELSE now() + make_interval(secs => ${options.retryInSeconds}) END`,
      claimedBy: null,
      heartbeatAt: null,
      lastError: describeError(error),
    })
    .where(heldBy(jobId, holder))
    .returning({ status: bffJobQueue.status })
  if (!row) return null
  return row.status === 'dead' ? 'dead' : 'queued'
}

export async function killJob(jobId: string, holder: string, reason: string): Promise<void> {
  await getDb()
    .update(bffJobQueue)
    .set({ status: 'dead', deadAt: sql`now()`, payload: scrubbedPayload, claimedBy: null, heartbeatAt: null, lastError: describeError(reason) })
    .where(heldBy(jobId, holder))
}

export type JobToDispatch = Pick<BffJobRow, 'jobId' | 'kind' | 'lane' | 'priority' | 'claimedAt'>

export async function listJobsToDispatch(options: {
  graceSeconds: number
  staleSeconds: number
  limit: number
}): Promise<JobToDispatch[]> {
  const due = sql`greatest(${bffJobQueue.createdAt}, coalesce(${bffJobQueue.notBefore}, ${bffJobQueue.createdAt}))`
  return getDb()
    .select({
      jobId: bffJobQueue.jobId,
      kind: bffJobQueue.kind,
      lane: bffJobQueue.lane,
      priority: bffJobQueue.priority,
      claimedAt: bffJobQueue.claimedAt,
    })
    .from(bffJobQueue)
    .where(
      or(
        and(eq(bffJobQueue.status, 'queued'), lt(due, sql`now() - make_interval(secs => ${options.graceSeconds})`)),
        silentClaim(options.staleSeconds)
      )
    )
    .orderBy(asc(bffJobQueue.createdAt))
    .limit(options.limit)
}

export async function purgeDeadJobs(olderThanSeconds: number): Promise<number> {
  const rows = await getDb()
    .delete(bffJobQueue)
    .where(and(eq(bffJobQueue.status, 'dead'), lt(bffJobQueue.deadAt, sql`now() - make_interval(secs => ${olderThanSeconds})`)))
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length
}
