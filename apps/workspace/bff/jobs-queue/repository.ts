/**
 * Every query on `bff_job_queue` from the BFF (ADR-0017: the only module that
 * queries it).
 *
 * The row is a job's record: what was asked, how far it got, whether it is
 * waiting (`queued`), being run (`claimed`) or gave up (`dead`, its reason
 * kept). Hatchet decides WHEN a job runs and on which worker (`./orchestrator.ts`);
 * the row is what the run reads and leaves behind, and what the sweeps and the
 * "already running" answers read (`findOpenJobId`, `findDeadJob`). So a caller
 * still enqueues in its own transaction, a second click still finds the open
 * job, and a job's progress survives any pod, as before the move to Hatchet.
 */

import 'server-only'
import { and, asc, desc, eq, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { bffJobQueue, type BffJobPriority, type BffJobRow } from '@/lib/db/schema/bff-job-queue'
import { KEPT_PAYLOAD_KEYS } from '../../workers/job-queue.js'

/**
 * Add a job to the caller's own lane. Runs in the tenant scope of the request
 * that enqueues it: the table's WITH CHECK refuses a lane that is not the
 * active organization, so a route cannot enqueue into someone else's lane even
 * by mistake.
 *
 * `executor` is the caller's transaction when the job must exist exactly when
 * the caller's other writes do (the Papierkorb queues its jobs that way).
 * `jobId` lets such a caller stamp rows with the id before the insert returns;
 * `notBefore` holds the job back until then, the same column the retry backoff
 * uses.
 */
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

/**
 * {@link insertJob} for a job whose id is derived from what it is about: a
 * second enqueue of the same id is no job, not an error. Whether this call
 * added it. A finished job is deleted, so the id names the job only while it
 * waits or runs; the caller's own record says whether the work was done.
 */
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

/**
 * Withdraw a job nobody has claimed yet, in the caller's lane; whether it was
 * there. A claimed job is left alone: its worker owns it now, and a job that
 * may be withdrawn checks on its own whether it still has work.
 */
export async function deleteQueuedJob(jobId: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .delete(bffJobQueue)
    .where(and(eq(bffJobQueue.jobId, jobId), eq(bffJobQueue.status, 'queued')))
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length > 0
}

/**
 * The id of a job of this kind that is still waiting or running in the caller's
 * lane and whose payload contains `matching`, or `null`.
 *
 * What lets a second click on "Re-index project" answer with the job already
 * doing it instead of queueing the same walk twice. A dead job is not open: it
 * will never run, and a person pressing the button again wants a new one. The
 * `::text::jsonb` is not decoration: postgres-js types a bare `::jsonb`
 * parameter as JSON and encodes the string a second time, so `@>` would compare
 * against a JSON string and match nothing.
 *
 * `notStarted` narrows it to a job no worker has claimed yet: one that is
 * certain to read the database again from the start. A walk that takes what is
 * marked for it asks this, because a running job may already have looked.
 */
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

/**
 * The newest job of this kind in the caller's lane that gave up, with the
 * reason it gave, or `null`.
 *
 * What a sweep reads to tell "nothing is working on this" from "this was
 * tried and failed every attempt": a row left at `processing` or `queued`
 * whose only job is dead will never move on its own.
 */
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

/*
 * A run's lifecycle. The caller opens the platform scope (`./task.ts`):
 * a run has no tenant, and the row tells it which one it works in. The row is
 * held by one ATTEMPT, not by a run: `holder` names the Hatchet run, its retry
 * and the worker (`./task-run.ts`, `holderOf`), because a retry or a
 * reassigned copy of a run may start while the attempt before it still runs
 * (JavaScript cannot kill a slice past its timeout). Every write after the
 * take is conditional on `claimed_by = holder`, so an attempt that lost the row
 * can neither finish nor save what is no longer its own, and a take of a held
 * row waits until the holder is silent past `staleSeconds`.
 */

/** Stored text of a failure, so one runaway message cannot bloat the row. */
const MAX_ERROR_CHARS = 2000

/** A run may come up to this early for a row that waits (`not_before`): the clocks are not one. */
const EARLY_TOLERANCE_SECONDS = 30

/** The payload of a row going dead: its identifiers only. Reads that row's `payload`. */
const scrubbedPayload = sql`(
  SELECT COALESCE(jsonb_object_agg(kept.key, kept.value), '{}'::jsonb)
  FROM jsonb_each(CASE WHEN jsonb_typeof(${bffJobQueue.payload}) = 'object' THEN ${bffJobQueue.payload} ELSE '{}'::jsonb END) AS kept
  WHERE kept.key = ANY(string_to_array(${KEPT_PAYLOAD_KEYS.join(',')}, ','))
)`

const describeError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS)

const heldBy = (jobId: string, holder: string) =>
  and(eq(bffJobQueue.jobId, jobId), eq(bffJobQueue.claimedBy, holder), eq(bffJobQueue.status, 'claimed'))

/**
 * When the holder of a claimed row was last known alive: the newer of its
 * heartbeat and its take. The claim loop before Hatchet held one take across
 * many slices and refreshed only `heartbeat_at`, so `claimed_at` alone would
 * call a row it is still working on stale.
 */
const lastAlive = sql`coalesce(greatest(${bffJobQueue.heartbeatAt}, ${bffJobQueue.claimedAt}), ${bffJobQueue.createdAt})`

/** A claimed row whose holder has been silent for `staleSeconds`. */
const silentClaim = (staleSeconds: number) =>
  and(eq(bffJobQueue.status, 'claimed'), lt(lastAlive, sql`now() - make_interval(secs => ${staleSeconds})`))

/**
 * Take the job for `holder`: a row that waits and is due, or one whose holder
 * went silent for `staleSeconds` (which the caller keeps above the slice
 * timeout, `./task.ts`). Never a row another attempt holds and may
 * still be running, not even one held under the same name. `attempts` counts
 * the take. Null when there is nothing to take: the job is gone (finished,
 * purged, its enqueue rolled back or not committed yet), held by a live
 * attempt, dead, or not due.
 */
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

/** Whether the job's row exists at all, whatever its state: what tells "not committed yet" from "held". */
export async function jobExists(jobId: string): Promise<boolean> {
  const rows = await getDb().select({ jobId: bffJobQueue.jobId }).from(bffJobQueue).where(eq(bffJobQueue.jobId, jobId)).limit(1)
  return rows.length > 0
}

/** The holder is still at work on the job. Whether it still held it. */
export async function heartbeatJob(jobId: string, holder: string): Promise<boolean> {
  const rows = await getDb()
    .update(bffJobQueue)
    .set({ heartbeatAt: sql`now()` })
    .where(heldBy(jobId, holder))
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length > 0
}

/**
 * The pod is stopping with these attempts still running: queue their rows
 * again at once, so the next run takes each without waiting out the stale
 * window. One UPDATE, guarded per row on its holder, so a row another attempt
 * took over meanwhile is left alone and a second call is no change. The
 * attempt stays counted: a slice that is cut off at every drain still runs out
 * of attempts. How many rows went back.
 */
export async function releaseJobs(held: ReadonlyArray<{ jobId: string; holder: string }>): Promise<number> {
  if (held.length === 0) return 0
  const rows = await getDb()
    .update(bffJobQueue)
    .set({ status: 'queued', claimedBy: null, heartbeatAt: null })
    .where(or(...held.map(({ jobId, holder }) => heldBy(jobId, holder))))
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length
}

/** The job is done: its row goes. Whether this holder still held it. */
export async function finishJob(jobId: string, holder: string): Promise<boolean> {
  const rows = await getDb().delete(bffJobQueue).where(heldBy(jobId, holder)).returning({ jobId: bffJobQueue.jobId })
  return rows.length > 0
}

/**
 * A slice is done and the job is not: save where it got to and queue it again
 * (not before `notBefore` when it waits on something), its attempts back to
 * none, because it made progress. `claimed_at` stays: it names this take, and
 * so the next run's key (`./task.ts`, `generation`). Null when this
 * holder no longer held it.
 */
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

/**
 * The attempt went wrong: queued again, not before `retryInSeconds`, while it
 * has attempts left, or `dead` (its payload reduced to ids) when this was its
 * last. The reason is kept either way. Null when this holder no longer held it.
 */
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

/** Mark the job dead whatever its attempts: no run will do it (a kind nobody knows, a run lost on its last attempt). */
export async function killJob(jobId: string, holder: string, reason: string): Promise<void> {
  await getDb()
    .update(bffJobQueue)
    .set({ status: 'dead', deadAt: sql`now()`, payload: scrubbedPayload, claimedBy: null, heartbeatAt: null, lastError: describeError(reason) })
    .where(heldBy(jobId, holder))
}

/** A row the dispatch sweep starts a run for. */
export type JobToDispatch = Pick<BffJobRow, 'jobId' | 'kind' | 'lane' | 'priority' | 'claimedAt'>

/**
 * Rows no run is coming for, oldest first: queued and due for longer than
 * `graceSeconds` (an enqueue whose trigger failed or ran before its transaction
 * committed, a row from before Hatchet, an `insertJobIfAbsent`), or claimed by
 * a holder silent for `staleSeconds` (its pod died on the last retry, or a
 * retry found it still held and left it). Silent by the newer of heartbeat
 * and take, so a row the claim loop before Hatchet is still working on is not
 * one.
 */
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

/** Delete the dead rows older than the retention: a dead row is the trace of a failure, not a record. How many went. */
export async function purgeDeadJobs(olderThanSeconds: number): Promise<number> {
  const rows = await getDb()
    .delete(bffJobQueue)
    .where(and(eq(bffJobQueue.status, 'dead'), lt(bffJobQueue.deadAt, sql`now() - make_interval(secs => ${olderThanSeconds})`)))
    .returning({ jobId: bffJobQueue.jobId })
  return rows.length
}
