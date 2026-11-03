/**
 * What one `bff-job` run does (ADR-0150), and the sweep that starts the runs
 * nobody started. The contract they follow is `./hatchet-task.ts`; the SDK
 * calls in through `./hatchet.ts`, which is handed these two by the pod
 * (`./slice-entry.ts`), so the enqueue side never imports the handlers.
 */

import 'server-only'
import { runWithTenantSlot, withPlatformAccess } from '@/lib/db/tenant-context'
import { maxAttempts } from './attempts'
import {
  deadRetentionSeconds,
  HEARTBEAT_SECONDS,
  PermanentJobError,
  priorityName,
  retryDelaySeconds,
  RetryLaterError,
  sliceTimeoutMs,
  staleSeconds,
  UNCOMMITTED_LOOKS,
  UNCOMMITTED_RETRY_SECONDS,
  type BffJobRunContext,
  type BffJobRuns,
  type BffJobTaskInput,
  type BffJobTaskOutput,
  type Env,
} from './hatchet-task'
import {
  failJob,
  finishJob,
  heartbeatJob,
  jobExists,
  killJob,
  listJobsToDispatch,
  purgeDeadJobs,
  saveJobProgress,
  takeJob,
} from './repository'
import { runHandler, UnknownJobKindError } from './run'

const LOG = '[bff-jobs]'

const deadLine = (input: BffJobTaskInput, attempts: number, reason: unknown) =>
  // The line the claim queue wrote for a dead job, which opens an issue. On the pod only: Hatchet gets the class.
  console.error(`${LOG} ${input.kind} ${input.job_id} is now dead after ${attempts} attempt(s):`, reason)

/**
 * Who holds the row while this attempt runs. Not the run alone: Hatchet retries
 * a slice past its timeout under the same run id while the first attempt may
 * still be running, and reassigns a lost worker's run without a new retry
 * count, so the retry and the worker are part of the name. A second copy then
 * never matches the first one's claim, and waits for it to go silent.
 */
export function holderOf({ run, retryCount, workerId }: BffJobRunContext): string {
  return workerId ? `${run}/${retryCount}@${workerId}` : `${run}/${retryCount}`
}

/**
 * One run of `bff-job`: take the row, run one slice in its organization, and
 * leave the row as the slice left it. The row is held by {@link holderOf}.
 */
export function runBffJobTask(
  input: BffJobTaskInput,
  context: BffJobRunContext,
  runs: BffJobRuns,
  env: Env = process.env
): Promise<BffJobTaskOutput> {
  // A run starts with no tenant and leaves none behind for the next one on this process.
  return runWithTenantSlot(() => runTaken(input, context, runs, env))
}

const platform = <T>(why: string, fn: () => Promise<T>) => withPlatformAccess(`bff-jobs: ${why}`, fn)

/**
 * Refresh the row's heartbeat while the slice runs, so neither a later run nor
 * the claim loop of a release before Hatchet takes it as silent. It stops when
 * Hatchet aborts the attempt or the slice timeout passes: a slice that hangs
 * past both goes silent, and its row is taken over once it is stale.
 */
function keepAlive(jobId: string, holder: string, env: Env, signal?: AbortSignal): () => void {
  const until = Date.now() + sliceTimeoutMs(env)
  const timer = setInterval(() => {
    if (signal?.aborted || Date.now() >= until) return clearInterval(timer)
    platform('refresh the heartbeat of a running slice', () => heartbeatJob(jobId, holder)).catch((error: unknown) =>
      console.warn(`${LOG} could not refresh the heartbeat of ${jobId}:`, error)
    )
  }, HEARTBEAT_SECONDS * 1000)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** Nothing to take. A row that is not there yet is looked for again shortly; anything else is no work. */
async function nothingToTake(jobId: string, retryCount: number): Promise<BffJobTaskOutput> {
  if (retryCount < UNCOMMITTED_LOOKS && !(await platform('see whether the row exists yet', () => jobExists(jobId)))) {
    throw new RetryLaterError('not-committed', UNCOMMITTED_RETRY_SECONDS)
  }
  return { job_id: jobId, outcome: 'skipped' }
}

async function runTaken(input: BffJobTaskInput, context: BffJobRunContext, runs: BffJobRuns, env: Env): Promise<BffJobTaskOutput> {
  const jobId = input.job_id
  const holder = holderOf(context)
  const row = await platform('take the row this run was started for', () => takeJob(jobId, holder, { staleSeconds: staleSeconds(env) }))
  if (!row) return nothingToTake(jobId, context.retryCount)
  const limit = maxAttempts(env)
  if (row.attempts > limit) {
    const reason = `worker lost on its last attempt (${limit} attempts)`
    await platform('mark a lost job dead', () => killJob(jobId, holder, reason))
    deadLine(input, limit, reason)
    return { job_id: jobId, outcome: 'skipped' }
  }

  const stopBeating = keepAlive(jobId, holder, env, context.signal)
  let result
  try {
    result = await runHandler({ kind: row.kind, organizationId: row.lane, payload: row.payload, attempts: row.attempts, signal: context.signal })
  } catch (error) {
    return await failed(input, holder, row.attempts, error, env)
  } finally {
    stopBeating()
  }

  if (result.done) {
    await platform('finish a job', () => finishJob(jobId, holder))
    return { job_id: jobId, outcome: 'done' }
  }
  const saved = await platform('save a slice', () => saveJobProgress(jobId, holder, result.payload, result.notBefore ?? null))
  if (!saved) return { job_id: jobId, outcome: 'skipped' }
  const next: BffJobTaskInput = { ...input, generation: saved.claimedAt?.getTime() ?? 0 }
  // The row is saved either way: a trigger that fails is the sweep's to repeat.
  await runs.trigger(next, result.notBefore ? { notBefore: result.notBefore } : {}).catch((error: unknown) => {
    console.warn(`${LOG} could not trigger the next slice of ${jobId}; the sweep will:`, error)
  })
  return { job_id: jobId, outcome: 'more' }
}

/**
 * The slice threw: record it on the row and tell Hatchet what comes next. The
 * row keeps the message; Hatchet gets our category and the error's class
 * (`failureText`), and the pod's log the whole error.
 */
async function failed(input: BffJobTaskInput, holder: string, attempts: number, error: unknown, env: Env): Promise<BffJobTaskOutput> {
  const jobId = input.job_id
  if (error instanceof UnknownJobKindError) {
    await platform('mark a job of an unknown kind dead', () => killJob(jobId, holder, error.message))
    deadLine(input, attempts, error)
    throw new PermanentJobError('unknown-kind', error)
  }
  const limit = maxAttempts(env)
  const retryIn = retryDelaySeconds(attempts, env)
  const status = await platform('record a failed attempt', () => failJob(jobId, holder, error, { maxAttempts: limit, retryInSeconds: retryIn }))
  if (status === 'dead') {
    deadLine(input, attempts, error)
    throw new PermanentJobError('dead', error)
  }
  if (status === null) return { job_id: jobId, outcome: 'skipped' }
  console.warn(`${LOG} ${input.kind} ${jobId} attempt ${attempts} failed; again in ${retryIn}s:`, error)
  throw new RetryLaterError('attempt-failed', retryIn, error)
}

/** Rows one sweep dispatches; the rest wait for the next. */
const DISPATCH_BATCH = 200
/** How long a queued, due row may wait for the run its enqueue triggered before the sweep starts one. */
const DISPATCH_GRACE_SECONDS = 120

/**
 * Start a run for every row no run is coming for, and delete the dead rows past
 * their retention. Every `bff-jobs` replica runs it on a timer (`./hatchet.ts`);
 * a second replica's trigger of the same row is the same key, so it is no run.
 * This is also the cutover: the rows the claim queue left behind are
 * dispatched by the first sweep after the deploy.
 */
export async function dispatchStrandedJobs(
  runs: BffJobRuns,
  env: Env = process.env
): Promise<{ dispatched: number; failed: number; purged: number }> {
  const rows = await withPlatformAccess('bff-jobs: find the jobs no run is coming for', () =>
    listJobsToDispatch({ graceSeconds: DISPATCH_GRACE_SECONDS, staleSeconds: staleSeconds(env), limit: DISPATCH_BATCH })
  )
  let dispatched = 0
  let failed = 0
  for (const row of rows) {
    try {
      await runs.trigger(
        { job_id: row.jobId, kind: row.kind, organization_id: row.lane, priority: priorityName(row.priority), generation: row.claimedAt?.getTime() ?? 0 },
        {}
      )
      dispatched += 1
    } catch (error) {
      failed += 1
      console.warn(`[bff-jobs] could not dispatch ${row.kind} ${row.jobId}:`, error)
    }
  }
  const purged = await withPlatformAccess('bff-jobs: delete dead jobs past their retention', () =>
    purgeDeadJobs(deadRetentionSeconds(env))
  )
  return { dispatched, failed, purged }
}
