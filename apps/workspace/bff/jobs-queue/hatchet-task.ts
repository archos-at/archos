/**
 * The `bff-job` task on Hatchet (ADR-0150): its contract, and what one run does.
 *
 * One task for every kind. Hatchet decides when a job runs and where; the job's
 * row in `bff_job_queue` is what it runs (`./repository.ts`): the run takes the
 * row, runs one slice through the same `JOB_HANDLERS` as ever (`./run.ts`), and
 * leaves the row finished, saved for the next slice, failed or dead. So the
 * input carries ids and the priority only, never a payload: no tenant content
 * reaches Hatchet's database, and nothing needs sealing.
 *
 * This file is the contract; `./hatchet-run.ts` is what a run does, and
 * `./hatchet.ts` the only module that imports the SDK, which registers and
 * triggers the task and passes on what this file says unchanged. Neither this
 * file nor the handlers import the SDK, so the orchestrator stays replaceable:
 *
 * - FAIRNESS. Concurrency keyed on `input.organization_id`, `GROUP_ROUND_ROBIN`,
 *   at most `BFF_JOBS_MAX_PER_ORG` runs of one organization at once; 0 (no cap)
 *   is one replica's slots, because Hatchet needs a number.
 * - PRIORITY. Interactive before bulk, as the run's priority.
 * - ATTEMPTS. The row counts them (a take is one), as it always did:
 *   `BFF_JOBS_MAX_ATTEMPTS`, then `dead` with the reason kept. A failed attempt
 *   is retried by Hatchet after `BFF_JOBS_RETRY_BACKOFF_SECONDS`, doubling, at
 *   most 15 minutes; a kind nobody knows is not retried at all.
 *   `BFF_JOBS_SLICE_TIMEOUT_MS` bounds a run.
 * - ONE COPY AT A TIME. Hatchet retries a slice past its timeout, and
 *   reassigns a lost worker's run, while the first copy may still run: no
 *   JavaScript can kill it. So the row is held by one attempt (`holderOf`,
 *   `./hatchet-run.ts`), which heartbeats while it runs, and is taken from it
 *   only once it is silent past {@link staleSeconds}, never by a retry that
 *   merely shares its run id.
 * - NO TEXT. Hatchet stores what a run throws. A failure reaches it as our
 *   category and the error's class ({@link failureText}); the message stays on
 *   the row and in the pod's log.
 * - A SLICE IS A RUN. A job that is not done saves its progress on its row and
 *   triggers the next run (at `notBefore` when it waits), so each slice queues
 *   again behind other organizations' work and a drained pod loses nothing.
 * - NO RUN IS LOST. A row no run is coming for (an enqueue whose trigger failed,
 *   or that ran before its transaction committed; a row from before Hatchet; a
 *   run whose pod died on its last retry) is dispatched again by
 *   {@link dispatchStrandedJobs}. Hatchet's idempotency, keyed on the job and
 *   the take it resumes from (`generation`), keeps that from starting a second
 *   run while the first still waits or runs.
 */

import { DEFAULT_RETRY_BACKOFF_SECONDS, MAX_RETRY_BACKOFF_SECONDS } from '../../workers/job-queue.js'
import { maxAttempts } from './attempts'
import { BFF_JOB_PRIORITY, type BffJobPriority } from './types'

export const BFF_JOB_TASK = 'bff-job'

export type BffJobPriorityName = 'interactive' | 'bulk'

/** What a `bff-job` run carries: ids, the priority, and which take of the row it resumes. Never a payload. */
export interface BffJobTaskInput {
  [key: string]: string | number
  job_id: string
  kind: string
  organization_id: string
  priority: BffJobPriorityName
  /** The row's `claimed_at` (ms) when this run was triggered; 0 for a row no run has taken yet. */
  generation: number
}

/** What a run answers: Hatchet stores it, so ids and states only. */
export interface BffJobTaskOutput {
  [key: string]: string | boolean
  job_id: string
  /** `done`, `more` (the next slice is triggered), or `skipped` (nothing to take: gone, held, dead, not due). */
  outcome: 'done' | 'more' | 'skipped'
}

/** Hatchet's run priorities (the SDK's `Priority`): interactive is HIGH, bulk is LOW. */
export const RUN_PRIORITY: Record<BffJobPriorityName, 1 | 3> = { interactive: 3, bulk: 1 }

export const priorityName = (priority: BffJobPriority): BffJobPriorityName =>
  priority === BFF_JOB_PRIORITY.interactive ? 'interactive' : 'bulk'

/** Everything the SDK is told about the task, from the pod's environment. */
export interface BffJobTaskSpec {
  name: typeof BFF_JOB_TASK
  concurrency: { expression: 'input.organization_id'; maxRuns: number; limitStrategy: 'GROUP_ROUND_ROBIN' }
  idempotency: { strategy: 'status'; expression: string; fallbackTtlMs: number }
  retries: number
  executionTimeoutMs: number
  /** How long a run may wait for a slot: Hatchet's run retention. The row outlives it, and the sweep starts another. */
  scheduleTimeout: '336h'
  /** Runs one worker takes at once. */
  slots: number
}

export type Env = Record<string, string | undefined>

const RETENTION_MS = 14 * 24 * 3_600_000

function toInt(raw: string | undefined, fallback: number, min = 1): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n >= min ? n : fallback
}

export function bffJobTaskSpec(env: Env = process.env): BffJobTaskSpec {
  const slots = toInt(env.BFF_JOBS_CONCURRENCY, 2)
  const perOrg = toInt(env.BFF_JOBS_MAX_PER_ORG, 0, 0)
  return {
    name: BFF_JOB_TASK,
    concurrency: { expression: 'input.organization_id', maxRuns: perOrg || slots, limitStrategy: 'GROUP_ROUND_ROBIN' },
    idempotency: { strategy: 'status', expression: "input.job_id + '/' + string(input.generation)", fallbackTtlMs: RETENTION_MS },
    // The row decides when a job is dead; the spare retries are for a run that came before its enqueue committed.
    retries: maxAttempts(env) + UNCOMMITTED_LOOKS,
    executionTimeoutMs: sliceTimeoutMs(env),
    scheduleTimeout: '336h',
    slots,
  }
}

/**
 * A run whose row is not there yet (its enqueue's transaction has not
 * committed) looks again after this long, at most {@link UNCOMMITTED_LOOKS}
 * times, through Hatchet's retry-after; then the dispatch sweep has it.
 */
export const UNCOMMITTED_RETRY_SECONDS = 10
export const UNCOMMITTED_LOOKS = 3

/** How often a running slice refreshes its row's heartbeat, the interval of the claim loop before Hatchet. */
export const HEARTBEAT_SECONDS = 15

/** `BFF_JOBS_SLICE_TIMEOUT_MS`: Hatchet's execution timeout for one slice. */
export function sliceTimeoutMs(env: Env = process.env): number {
  return toInt(env.BFF_JOBS_SLICE_TIMEOUT_MS, 300_000)
}

/** What a holder may stay silent past its slice timeout before its row is taken from it. */
const STALE_MARGIN_SECONDS = 60

/**
 * A holder silent this long (by the newer of its heartbeat and its take) has
 * lost its row. Never shorter than a slice may legitimately take plus a margin,
 * so a slice still running past its timeout is not run a second time beside
 * itself, and never within reach of the heartbeat interval, so neither a slice
 * on Hatchet nor the claim loop before it is called dead while it beats.
 */
export function staleSeconds(env: Env = process.env): number {
  const timeoutSeconds = Math.ceil(sliceTimeoutMs(env) / 1000)
  return Math.max(toInt(env.BFF_JOBS_STALE_SECONDS, 180), timeoutSeconds + STALE_MARGIN_SECONDS, HEARTBEAT_SECONDS * 4)
}

/** How long a job waits after its `attempts`-th attempt failed: the claim queue's backoff, to the second. */
export function retryDelaySeconds(attempts: number, env: Env = process.env): number {
  const base = toInt(env.BFF_JOBS_RETRY_BACKOFF_SECONDS, DEFAULT_RETRY_BACKOFF_SECONDS, 0)
  return Math.min(base * 2 ** Math.max(attempts - 1, 0), MAX_RETRY_BACKOFF_SECONDS)
}

/** What a run knows of itself: Hatchet's run id, its retry, the worker it is on, and the signal Hatchet aborts it with. */
export interface BffJobRunContext {
  run: string
  retryCount: number
  workerId?: string
  signal?: AbortSignal
}

/** The one seam to Hatchet: start a `bff-job` run, now or at `notBefore`, and return. */
export interface BffJobRuns {
  trigger(input: BffJobTaskInput, options: { notBefore?: Date }): Promise<void>
}

/** An error's class, when its name is one: never its message, which can carry a file name or a URL. */
function errorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Error'
}

/**
 * The only text about a failure that Hatchet is given: our category and the
 * error's class (`dead: TypeError`). Hatchet stores it, with the stack of the
 * error that carries it, in its database and shows it on its dashboard, where
 * ids and ciphertext are all an office's work may leave behind (ADR-0150). The
 * full error is logged on the pod, never sent.
 */
export function failureText(category: string, error?: unknown): string {
  return error === undefined ? category : `${category}: ${errorClass(error)}`
}

/** A failure no attempt will change; the SDK layer makes it Hatchet's non-retryable error. Its message is {@link failureText}. */
export class PermanentJobError extends Error {
  override name = 'PermanentJobError'
  constructor(category: string, error?: unknown) {
    super(failureText(category, error))
  }
}

/** Try this run again after `afterSeconds`; the SDK layer makes it Hatchet's retry-after error. Its message is {@link failureText}. */
export class RetryLaterError extends Error {
  override name = 'RetryLaterError'
  constructor(category: string, readonly afterSeconds: number, error?: unknown) {
    super(failureText(category, error))
  }
}


/** How long a dead row is kept as a trace before it is deleted. */
export function deadRetentionSeconds(env: Env = process.env): number {
  return toInt(env.BFF_JOBS_DEAD_RETENTION_DAYS, 14) * 86_400
}
