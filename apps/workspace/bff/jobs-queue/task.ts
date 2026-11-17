import { DEFAULT_RETRY_BACKOFF_SECONDS, MAX_RETRY_BACKOFF_SECONDS } from '../../workers/job-queue.js'
import { maxAttempts } from './attempts'
import { BFF_JOB_PRIORITY, type BffJobPriority } from './types'

export const BFF_JOB_TASK = 'bff-job'

export type BffJobPriorityName = 'interactive' | 'bulk'

export interface BffJobTaskInput {
  [key: string]: string | number
  job_id: string
  kind: string
  organization_id: string
  priority: BffJobPriorityName
  generation: number
}

export interface BffJobTaskOutput {
  [key: string]: string | boolean
  job_id: string
  outcome: 'done' | 'more' | 'skipped'
}

export const RUN_PRIORITY: Record<BffJobPriorityName, 1 | 3> = { interactive: 3, bulk: 1 }

export const priorityName = (priority: BffJobPriority): BffJobPriorityName =>
  priority === BFF_JOB_PRIORITY.interactive ? 'interactive' : 'bulk'

export interface BffJobTaskSpec {
  name: typeof BFF_JOB_TASK
  concurrency: { expression: 'input.organization_id'; maxRuns: number; limitStrategy: 'GROUP_ROUND_ROBIN' }
  idempotency: { strategy: 'status'; expression: string; fallbackTtlMs: number }
  retries: number
  executionTimeoutMs: number
  scheduleTimeout: '336h'
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
    retries: maxAttempts(env) + UNCOMMITTED_LOOKS,
    executionTimeoutMs: sliceTimeoutMs(env),
    scheduleTimeout: '336h',
    slots,
  }
}

export const UNCOMMITTED_RETRY_SECONDS = 10
export const UNCOMMITTED_LOOKS = 3

export const HEARTBEAT_SECONDS = 15

export function sliceTimeoutMs(env: Env = process.env): number {
  return toInt(env.BFF_JOBS_SLICE_TIMEOUT_MS, 300_000)
}

const STALE_MARGIN_SECONDS = 60

export function staleSeconds(env: Env = process.env): number {
  const timeoutSeconds = Math.ceil(sliceTimeoutMs(env) / 1000)
  return Math.max(toInt(env.BFF_JOBS_STALE_SECONDS, 180), timeoutSeconds + STALE_MARGIN_SECONDS, HEARTBEAT_SECONDS * 4)
}

export function retryDelaySeconds(attempts: number, env: Env = process.env): number {
  const base = toInt(env.BFF_JOBS_RETRY_BACKOFF_SECONDS, DEFAULT_RETRY_BACKOFF_SECONDS, 0)
  return Math.min(base * 2 ** Math.max(attempts - 1, 0), MAX_RETRY_BACKOFF_SECONDS)
}

export interface BffJobRunContext {
  run: string
  retryCount: number
  workerId?: string
  signal?: AbortSignal
}

export interface BffJobRuns {
  trigger(input: BffJobTaskInput, options: { notBefore?: Date }): Promise<void>
}

function errorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Error'
}

export function failureText(category: string, error?: unknown): string {
  return error === undefined ? category : `${category}: ${errorClass(error)}`
}

export class PermanentJobError extends Error {
  override name = 'PermanentJobError'
  constructor(category: string, error?: unknown) {
    super(failureText(category, error))
  }
}

export class RetryLaterError extends Error {
  override name = 'RetryLaterError'
  constructor(category: string, readonly afterSeconds: number, error?: unknown) {
    super(failureText(category, error))
  }
}


export function deadRetentionSeconds(env: Env = process.env): number {
  return toInt(env.BFF_JOBS_DEAD_RETENTION_DAYS, 14) * 86_400
}
