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
} from './task'
import {
  failJob,
  finishJob,
  heartbeatJob,
  jobExists,
  killJob,
  listJobsToDispatch,
  purgeDeadJobs,
  releaseJobs,
  saveJobProgress,
  takeJob,
} from './repository'
import { runHandler, UnknownJobKindError } from './run'
import { failDocumentsOfDeadJob } from '@/lib/documents/stuck-processing'
import type { BffJobRow } from '@/lib/db/schema/bff-job-queue'

const LOG = '[bff-jobs]'

async function buried(input: BffJobTaskInput, attempts: number, reason: unknown): Promise<void> {
  console.error(`${LOG} ${input.kind} ${input.job_id} is now dead after ${attempts} attempt(s):`, reason)
  await failDocumentsOfDeadJob(input.job_id).catch((error: unknown) =>
    console.warn(`${LOG} could not fail the documents of dead job ${input.job_id}; the sweep will:`, error)
  )
}

export function holderOf({ run, retryCount, workerId }: BffJobRunContext): string {
  return workerId ? `${run}/${retryCount}@${workerId}` : `${run}/${retryCount}`
}

export function runBffJobTask(
  input: BffJobTaskInput,
  context: BffJobRunContext,
  runs: BffJobRuns,
  env: Env = process.env
): Promise<BffJobTaskOutput> {
  return runWithTenantSlot(() => runTaken(input, context, runs, env))
}

const platform = <T>(why: string, fn: () => Promise<T>) => withPlatformAccess(`bff-jobs: ${why}`, fn)

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

async function nothingToTake(jobId: string, retryCount: number): Promise<BffJobTaskOutput> {
  if (retryCount < UNCOMMITTED_LOOKS && !(await platform('see whether the row exists yet', () => jobExists(jobId)))) {
    throw new RetryLaterError('not-committed', UNCOMMITTED_RETRY_SECONDS)
  }
  return { job_id: jobId, outcome: 'skipped' }
}

const inFlight = new Map<string, string>()

export async function releaseInFlightJobs(): Promise<number> {
  const held = Array.from(inFlight, ([holder, jobId]) => ({ jobId, holder }))
  if (held.length === 0) return 0
  try {
    const released = await platform('give back the rows of a stopping pod', () => releaseJobs(held))
    for (const { holder } of held) inFlight.delete(holder)
    console.warn(`${LOG} stopping: gave back ${released} of ${held.length} row(s) still running`)
    return released
  } catch (error) {
    console.error(`${LOG} stopping: could not give back ${held.length} row(s); they are taken over once stale:`, error)
    return 0
  }
}

async function runTaken(input: BffJobTaskInput, context: BffJobRunContext, runs: BffJobRuns, env: Env): Promise<BffJobTaskOutput> {
  const jobId = input.job_id
  const holder = holderOf(context)
  const row = await platform('take the row this run was started for', () => takeJob(jobId, holder, { staleSeconds: staleSeconds(env) }))
  if (!row) return nothingToTake(jobId, context.retryCount)
  inFlight.set(holder, jobId)
  try {
    return await runHeld(input, row, holder, context, runs, env)
  } finally {
    inFlight.delete(holder)
  }
}

async function runHeld(
  input: BffJobTaskInput,
  row: BffJobRow,
  holder: string,
  context: BffJobRunContext,
  runs: BffJobRuns,
  env: Env
): Promise<BffJobTaskOutput> {
  const jobId = input.job_id
  const limit = maxAttempts(env)
  if (row.attempts > limit) {
    const reason = `worker lost on its last attempt (${limit} attempts)`
    await platform('mark a lost job dead', () => killJob(jobId, holder, reason))
    await buried(input, limit, reason)
    return { job_id: jobId, outcome: 'skipped' }
  }

  const stopBeating = keepAlive(jobId, holder, env, context.signal)
  let result
  try {
    result = await runHandler({ jobId, kind: row.kind, organizationId: row.lane, payload: row.payload, attempts: row.attempts, signal: context.signal })
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
  await runs.trigger(next, result.notBefore ? { notBefore: result.notBefore } : {}).catch((error: unknown) => {
    console.warn(`${LOG} could not trigger the next slice of ${jobId}; the sweep will:`, error)
  })
  return { job_id: jobId, outcome: 'more' }
}

async function failed(input: BffJobTaskInput, holder: string, attempts: number, error: unknown, env: Env): Promise<BffJobTaskOutput> {
  const jobId = input.job_id
  if (error instanceof UnknownJobKindError) {
    await platform('mark a job of an unknown kind dead', () => killJob(jobId, holder, error.message))
    await buried(input, attempts, error)
    throw new PermanentJobError('unknown-kind', error)
  }
  const limit = maxAttempts(env)
  const retryIn = retryDelaySeconds(attempts, env)
  const status = await platform('record a failed attempt', () => failJob(jobId, holder, error, { maxAttempts: limit, retryInSeconds: retryIn }))
  if (status === 'dead') {
    await buried(input, attempts, error)
    throw new PermanentJobError('dead', error)
  }
  if (status === null) return { job_id: jobId, outcome: 'skipped' }
  console.warn(`${LOG} ${input.kind} ${jobId} attempt ${attempts} failed; again in ${retryIn}s:`, error)
  throw new RetryLaterError('attempt-failed', retryIn, error)
}

const DISPATCH_BATCH = 200
const DISPATCH_GRACE_SECONDS = 120

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
