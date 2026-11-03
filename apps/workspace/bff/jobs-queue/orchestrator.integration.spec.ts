/**
 * @vitest-environment node
 *
 * `bff-job` on a REAL Hatchet engine over a REAL Postgres: the main evidence
 * that the BFF's jobs run on Hatchet as they ran on the claim queue. A worker
 * registers the task through the SDK, `enqueueJob` stores a row and triggers
 * a run, and the run takes the row and calls the handler; only the handler is
 * scripted (`@/test-utils/scripted-job-handlers`). Covered: a job end to end,
 * a retry, a failure that is not retried, a slice that waits (a scheduled
 * run), fairness between two organizations under a burst, and the
 * per-organization cap.
 *
 * Runs when an engine and the database are there (CI's hatchet-lite service and
 * `task db:test:rls`); skips otherwise:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *   HATCHET_CLIENT_TOKEN=… HATCHET_CLIENT_HOST_PORT=localhost:7077 HATCHET_CLIENT_TLS_STRATEGY=none \
 *     npx vitest run bff/jobs-queue/orchestrator.integration.spec.ts
 */
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { handled, type HandledCall } from '@/test-utils/scripted-job-handlers'

vi.mock('server-only', () => ({}))
vi.mock('./handlers', async () => ({ JOB_HANDLERS: (await import('@/test-utils/scripted-job-handlers')).SCRIPTED_HANDLERS }))

const url = process.env.TEST_DATABASE_URL
const engine = Boolean(process.env.HATCHET_CLIENT_TOKEN && process.env.HATCHET_CLIENT_HOST_PORT)
const STAMP = Date.now()
const ORG_A = `org_hatchet_a_${STAMP}`
const ORG_B = `org_hatchet_b_${STAMP}`

const callsOf = (id: string): HandledCall[] => handled.filter((call) => call.id === id)

describe.skipIf(!url || !engine)('bff-job on a real Hatchet engine', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let context: typeof import('@/lib/db/tenant-context')
  let enqueueJob: typeof import('./enqueue').enqueueJob
  let stop: (() => Promise<void>) | null = null

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    // Its own namespace, so no other worker of `bff-job` takes these runs, and
    // the settings the task is registered with: one run per organization, three
    // per worker, a second's backoff, two attempts.
    process.env.HATCHET_CLIENT_NAMESPACE = `${process.env.HATCHET_CLIENT_NAMESPACE ?? 'it'}_bffjobs_${STAMP}`
    process.env.BFF_JOBS_MAX_PER_ORG = '1'
    process.env.BFF_JOBS_CONCURRENCY = '3'
    process.env.BFF_JOBS_MAX_ATTEMPTS = '2'
    process.env.BFF_JOBS_RETRY_BACKOFF_SECONDS = '1'
    context = await import('@/lib/db/tenant-context')
    db = (await import('@/lib/db')).getDb()
    enqueueJob = (await import('./enqueue')).enqueueJob
    const { startBffJobWorker } = await import('./orchestrator')
    const work = await import('./task-run')
    const worker = await startBffJobWorker(`bff-jobs-it-${STAMP}`, { run: work.runBffJobTask, sweep: work.dispatchStrandedJobs })
    stop = worker.stop
  }, 120_000)

  afterAll(async () => {
    await stop?.()
    if (!db) return
    await context.withPlatformAccess('test teardown', () => db.execute(sql`DELETE FROM bff_job_queue WHERE lane IN (${ORG_A}, ${ORG_B})`))
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  const enqueue = (organizationId: string, payload: Record<string, unknown>, priority: 0 | 1 = 0) =>
    context.withTenant({ organizationId }, () => enqueueJob({ kind: 'inbox_push', organizationId, payload, priority }))
  const rowOf = async (jobId: string) => {
    const rows = await context.withPlatformAccess('test: read the row', () =>
      db.execute<Record<string, unknown>>(sql`SELECT status, attempts, last_error FROM bff_job_queue WHERE job_id = ${jobId}::uuid`),
    )
    return Array.from(rows)[0] ?? null
  }
  const waitFor = (check: () => Promise<void> | void, timeout = 60_000) => vi.waitFor(check, { timeout, interval: 250 })

  it('runs an enqueued job through its handler and deletes its row', async () => {
    const { jobId } = await enqueue(ORG_A, { id: 'e2e', mode: 'ok' })

    await waitFor(async () => expect(await rowOf(jobId)).toBeNull())
    expect(callsOf('e2e')).toEqual([expect.objectContaining({ organizationId: ORG_A, attempts: 1 })])
  }, 90_000)

  it('retries a failed attempt after its backoff, telling the handler its attempt', async () => {
    const { jobId } = await enqueue(ORG_A, { id: 'retry', mode: 'fail-once' })

    await waitFor(async () => expect(await rowOf(jobId)).toBeNull())
    const calls = callsOf('retry')
    expect(calls.map((call) => call.attempts)).toEqual([1, 2])
    expect(calls[1].startedAt - calls[0].endedAt).toBeGreaterThanOrEqual(900)
  }, 90_000)

  it('ends a job on its last attempt, dead with its reason, and is not retried past it', async () => {
    const { jobId } = await enqueue(ORG_A, { id: 'dead', mode: 'fail-always' })

    await waitFor(async () => expect(await rowOf(jobId)).toMatchObject({ status: 'dead', attempts: 2 }))
    expect((await rowOf(jobId))?.last_error).toBe('scripted failure of dead on attempt 2')
    // Hatchet had retries left; the non-retryable error is what stopped it.
    await new Promise((resolve) => setTimeout(resolve, 4000))
    expect(callsOf('dead')).toHaveLength(2)
  }, 90_000)

  it('runs a slice that waits as a scheduled run, not before its time', async () => {
    const { jobId } = await enqueue(ORG_B, { id: 'wait', mode: 'slices', left: 2, waitMs: 3000 })

    await waitFor(async () => expect(await rowOf(jobId)).toBeNull())
    const [first, second] = callsOf('wait')
    expect(second.startedAt - first.endedAt).toBeGreaterThanOrEqual(2500)
  }, 90_000)

  it('serves the second organization during the first one’s burst, one run per organization at a time', async () => {
    const before = handled.length
    const burst = await Promise.all([1, 2, 3, 4].map((n) => enqueue(ORG_A, { id: `burst-${n}`, mode: 'ok', ms: 1500 }, 1)))
    const { jobId: other } = await enqueue(ORG_B, { id: 'other', mode: 'ok', ms: 100 }, 1)

    await waitFor(async () => {
      for (const { jobId } of [...burst, { jobId: other }]) expect(await rowOf(jobId)).toBeNull()
    }, 120_000)
    const calls = handled.slice(before)
    const ofA = calls.filter((call) => call.organizationId === ORG_A).sort((a, b) => a.startedAt - b.startedAt)
    // The cap: no two of the first organization's runs overlap, though the worker has three slots.
    for (let i = 1; i < ofA.length; i += 1) expect(ofA[i].startedAt).toBeGreaterThanOrEqual(ofA[i - 1].endedAt - 50)
    // Fairness: the second organization does not wait behind the first one's backlog.
    const [b] = calls.filter((call) => call.id === 'other')
    expect(b.startedAt).toBeLessThan(ofA[ofA.length - 1].startedAt)
  }, 150_000)
})
