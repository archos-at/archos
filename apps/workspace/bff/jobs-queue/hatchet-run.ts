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
  PermanentJobError,
  priorityName,
  retryDelaySeconds,
  RetryLaterError,
  staleSeconds,
  type BffJobRuns,
  type BffJobTaskInput,
  type BffJobTaskOutput,
  type Env,
} from './hatchet-task'
import { failJob, finishJob, killJob, listJobsToDispatch, purgeDeadJobs, saveJobProgress, takeJob } from './repository'
import { runHandler, UnknownJobKindError } from './run'

/** The run of a row that was enqueued in a transaction may come before the commit: look once more, shortly. */
const UNCOMMITTED_RETRY_SECONDS = 2

const deadLine = (input: BffJobTaskInput, attempts: number, reason: string) =>
  // The line the claim queue wrote for a dead job, which opens an issue.
  console.error(`[bff-jobs] ${input.kind} ${input.job_id} is now dead after ${attempts} attempt(s): ${reason}`)

/**
 * One run of `bff-job`: take the row, run one slice in its organization, and
 * leave the row as the slice left it. `run` is the run's own id, which the
 * row is held by; `retryCount` is Hatchet's.
 */
export function runBffJobTask(
  input: BffJobTaskInput,
  context: { run: string; retryCount: number },
  runs: BffJobRuns,
  env: Env = process.env
): Promise<BffJobTaskOutput> {
  // A run starts with no tenant and leaves none behind for the next one on this process.
  return runWithTenantSlot(() => runTaken(input, context, runs, env))
}

async function runTaken(
  input: BffJobTaskInput,
  { run, retryCount }: { run: string; retryCount: number },
  runs: BffJobRuns,
  env: Env
): Promise<BffJobTaskOutput> {
  const jobId = input.job_id
  const platform = <T>(why: string, fn: () => Promise<T>) => withPlatformAccess(`bff-jobs: ${why}`, fn)
  const row = await platform('take the row this run was started for', () => takeJob(jobId, run, { staleSeconds: staleSeconds(env) }))
  if (!row) {
    if (retryCount === 0) throw new RetryLaterError(`${jobId} is not there to take yet`, UNCOMMITTED_RETRY_SECONDS)
    return { job_id: jobId, outcome: 'skipped' }
  }
  const limit = maxAttempts(env)
  if (row.attempts > limit) {
    const reason = `worker lost on its last attempt (${limit} attempts)`
    await platform('mark a lost job dead', () => killJob(jobId, run, reason))
    deadLine(input, limit, reason)
    return { job_id: jobId, outcome: 'skipped' }
  }

  let result
  try {
    result = await runHandler({ kind: row.kind, organizationId: row.lane, payload: row.payload, attempts: row.attempts })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof UnknownJobKindError) {
      await platform('mark a job of an unknown kind dead', () => killJob(jobId, run, message))
      deadLine(input, row.attempts, message)
      throw new PermanentJobError(message)
    }
    const retryIn = retryDelaySeconds(row.attempts, env)
    const status = await platform('record a failed attempt', () => failJob(jobId, run, error, { maxAttempts: limit, retryInSeconds: retryIn }))
    if (status === 'dead') {
      deadLine(input, row.attempts, message)
      throw new PermanentJobError(message)
    }
    if (status === null) return { job_id: jobId, outcome: 'skipped' }
    throw new RetryLaterError(message, retryIn)
  }

  if (result.done) {
    await platform('finish a job', () => finishJob(jobId, run))
    return { job_id: jobId, outcome: 'done' }
  }
  const saved = await platform('save a slice', () => saveJobProgress(jobId, run, result.payload, result.notBefore ?? null))
  if (!saved) return { job_id: jobId, outcome: 'skipped' }
  const next: BffJobTaskInput = { ...input, generation: saved.claimedAt?.getTime() ?? 0 }
  // The row is saved either way: a trigger that fails is the sweep's to repeat.
  await runs.trigger(next, result.notBefore ? { notBefore: result.notBefore } : {}).catch((error: unknown) => {
    console.warn(`[bff-jobs] could not trigger the next slice of ${jobId}; the sweep will:`, error)
  })
  return { job_id: jobId, outcome: 'more' }
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
