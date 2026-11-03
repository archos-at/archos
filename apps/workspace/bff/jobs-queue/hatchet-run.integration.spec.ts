/**
 * @vitest-environment node
 *
 * A `bff-job` run against a REAL Postgres, as the restricted runtime role: the
 * run takes its row, runs the slice, and leaves the row finished, saved,
 * failed or dead; the sweep finds the rows no run is coming for. The one fake
 * is the trigger (what Hatchet would be asked to start), recorded instead of
 * sent, and the handler is scripted (`@/test-utils/scripted-job-handlers`).
 * The same run through a real engine is `hatchet.integration.spec.ts`.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/jobs-queue/hatchet-run.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs it.
 */
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handled } from '@/test-utils/scripted-job-handlers'

vi.mock('server-only', () => ({}))
vi.mock('./handlers', async () => ({ JOB_HANDLERS: (await import('@/test-utils/scripted-job-handlers')).SCRIPTED_HANDLERS }))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_jobrun_${Date.now()}`
const ENV = { BFF_JOBS_MAX_ATTEMPTS: '2', BFF_JOBS_RETRY_BACKOFF_SECONDS: '30' }

describe.skipIf(!url)('a bff-job run over its row', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let context: typeof import('@/lib/db/tenant-context')
  let repo: typeof import('./repository')
  let task: typeof import('./hatchet-task')
  let work: typeof import('./hatchet-run')
  const triggered: { input: unknown; options: unknown }[] = []
  const runs = {
    trigger: async (input: unknown, options: unknown) => {
      triggered.push({ input, options })
    },
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    context = await import('@/lib/db/tenant-context')
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
    task = await import('./hatchet-task')
    work = await import('./hatchet-run')
  }, 60_000)

  beforeEach(() => {
    triggered.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterAll(async () => {
    if (!db) return
    await context.withPlatformAccess('test teardown', () => db.execute(sql`DELETE FROM bff_job_queue WHERE lane = ${ORG}`))
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  const enqueue = (payload: Record<string, unknown>, kind = 'inbox_push') =>
    context.withTenant({ organizationId: ORG }, () => repo.insertJob({ kind, organizationId: ORG, priority: 0, payload }))
  const inputFor = (jobId: string, kind = 'inbox_push') => ({ job_id: jobId, kind, organization_id: ORG, priority: 'interactive' as const, generation: 0 })
  const rowOf = async (jobId: string) => {
    const rows = await context.withPlatformAccess('test: read the row', () =>
      db.execute<Record<string, unknown>>(sql`SELECT status, attempts, payload, last_error FROM bff_job_queue WHERE job_id = ${jobId}::uuid`),
    )
    return Array.from(rows)[0] ?? null
  }
  const run = (jobId: string, retryCount = 0, kind = 'inbox_push', signal?: AbortSignal) =>
    work.runBffJobTask(inputFor(jobId, kind), { run: `run-${jobId}`, retryCount, workerId: 'w-1', signal }, runs, ENV)
  const claimed = async (jobId: string) => (await rowOf(jobId))?.status === 'claimed'
  const until = async (check: () => Promise<boolean>) => {
    const deadline = Date.now() + 10_000
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error('timed out waiting')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  it('runs a job to its end and deletes its row', async () => {
    const jobId = await enqueue({ id: 'ok', mode: 'ok' })

    expect(await run(jobId)).toEqual({ job_id: jobId, outcome: 'done' })
    expect(await rowOf(jobId)).toBeNull()
    expect(triggered).toEqual([])
  })

  it('saves a slice and starts the next run from this take, at the wait the handler named', async () => {
    const jobId = await enqueue({ id: 'slices', mode: 'slices', left: 2, waitMs: 60_000 })

    expect(await run(jobId)).toEqual({ job_id: jobId, outcome: 'more' })

    expect(await rowOf(jobId)).toMatchObject({ status: 'queued', attempts: 0, payload: { left: 1 } })
    expect(triggered).toHaveLength(1)
    const next = triggered[0] as { input: { generation: number }; options: { notBefore: Date } }
    expect(next.input.generation).toBeGreaterThan(0)
    expect(next.options.notBefore.getTime()).toBeGreaterThan(Date.now() + 50_000)
  })

  it('queues a failed attempt behind its backoff, then makes the last one dead with ids only', async () => {
    const jobId = await enqueue({ id: 'fail', mode: 'fail-always', projectId: 'p-1' })

    // Hatchet is told the category and the class; the row keeps the message.
    await expect(run(jobId)).rejects.toMatchObject({ name: 'RetryLaterError', afterSeconds: 30, message: 'attempt-failed: Error' })
    expect(await rowOf(jobId)).toMatchObject({ status: 'queued', attempts: 1 })

    // The retry is the same run; the backoff is over by the time it comes.
    await context.withPlatformAccess('test: the backoff is over', () =>
      db.execute(sql`UPDATE bff_job_queue SET not_before = now() WHERE job_id = ${jobId}::uuid`),
    )
    await expect(run(jobId, 1)).rejects.toBeInstanceOf(task.PermanentJobError)
    expect(await rowOf(jobId)).toMatchObject({
      status: 'dead',
      attempts: 2,
      payload: { projectId: 'p-1' },
      last_error: 'scripted failure of fail on attempt 2',
    })
  })

  it('makes a kind nobody knows dead at once, without a retry', async () => {
    const jobId = await enqueue({ id: 'coffee' }, 'make_coffee')

    await expect(run(jobId, 0, 'make_coffee')).rejects.toMatchObject({ name: 'PermanentJobError', message: 'unknown-kind: UnknownJobKindError' })
    expect(await rowOf(jobId)).toMatchObject({ status: 'dead', last_error: 'No handler for job kind "make_coffee"' })
  })

  it('looks again for a row it cannot see yet, every ten seconds a few times, then leaves it to the sweep', async () => {
    const missing = randomUUID()
    for (let retry = 0; retry < task.UNCOMMITTED_LOOKS; retry += 1) {
      await expect(run(missing, retry)).rejects.toMatchObject({ name: 'RetryLaterError', afterSeconds: 10, message: 'not-committed' })
    }
    expect(await run(missing, task.UNCOMMITTED_LOOKS)).toEqual({ job_id: missing, outcome: 'skipped' })
    // Hatchet has the retries for the looks on top of the row's attempts.
    expect(task.bffJobTaskSpec(ENV).retries).toBe(2 + task.UNCOMMITTED_LOOKS)
  })

  it('runs the job of a transaction that commits after its run came, on the next look', async () => {
    const jobId = randomUUID()
    await expect(run(jobId)).rejects.toMatchObject({ name: 'RetryLaterError', afterSeconds: 10 })

    await context.withTenant({ organizationId: ORG }, () =>
      repo.insertJob({ kind: 'inbox_push', organizationId: ORG, priority: 0, payload: { id: 'late', mode: 'ok' }, jobId }),
    )

    expect(await run(jobId, 1)).toEqual({ job_id: jobId, outcome: 'done' })
  })

  it('does not look again for a row that is there but held: it leaves it be', async () => {
    const jobId = await enqueue({ id: 'held', mode: 'ok' })
    await context.withPlatformAccess('test: another run holds it', () => repo.takeJob(jobId, 'run-other', { staleSeconds: 600 }))

    expect(await run(jobId, 0)).toEqual({ job_id: jobId, outcome: 'skipped' })
    expect(await rowOf(jobId)).toMatchObject({ status: 'claimed' })
  })

  it('never runs a slice twice at once: a retry of the same run leaves the row to the attempt still running', async () => {
    const jobId = await enqueue({ id: 'hung', mode: 'ok', ms: 1_500 })

    // Attempt 0 runs past its timeout: Hatchet retries the run while it still runs.
    const first = run(jobId, 0)
    await until(() => claimed(jobId))
    const retry = await run(jobId, 1)

    expect(retry).toEqual({ job_id: jobId, outcome: 'skipped' })
    expect(await first).toEqual({ job_id: jobId, outcome: 'done' })
    expect(handled.filter((call) => call.id === 'hung')).toHaveLength(1)
  })

  it('takes over an attempt only once it is silent past the stale window, and refuses the old attempt’s writes', async () => {
    const jobId = await enqueue({ id: 'taken-over', mode: 'ok' })
    const old = work.holderOf({ run: `run-${jobId}`, retryCount: 0, workerId: 'w-1' })
    await context.withPlatformAccess('test: attempt 0 took it', () => repo.takeJob(jobId, old, { staleSeconds: 600 }))
    await context.withPlatformAccess('test: attempt 0 went silent past the window', () =>
      db.execute(sql`UPDATE bff_job_queue SET claimed_at = now() - interval '1 hour', heartbeat_at = now() - interval '1 hour' WHERE job_id = ${jobId}::uuid`),
    )

    expect(await run(jobId, 1)).toEqual({ job_id: jobId, outcome: 'done' })
    expect(await context.withPlatformAccess('test: the old attempt finishes', () => repo.finishJob(jobId, old))).toBe(false)
  })

  it('does not start a slice whose attempt Hatchet has already given up', async () => {
    const jobId = await enqueue({ id: 'aborted', mode: 'ok' })
    const aborted = new AbortController()
    aborted.abort()

    await expect(run(jobId, 0, 'inbox_push', aborted.signal)).rejects.toMatchObject({ name: 'RetryLaterError', message: 'attempt-failed: SliceAbortedError' })

    expect(handled.filter((call) => call.id === 'aborted')).toHaveLength(0)
    expect(await rowOf(jobId)).toMatchObject({ status: 'queued', attempts: 1 })
  })

  it('dispatches a row whose run never came, keyed on the take it resumes', async () => {
    const jobId = await enqueue({ id: 'stranded', mode: 'ok' })
    await context.withPlatformAccess('test: the row has waited past the grace', () =>
      db.execute(sql`UPDATE bff_job_queue SET created_at = now() - interval '10 minutes' WHERE job_id = ${jobId}::uuid`),
    )

    const swept = await work.dispatchStrandedJobs(runs, ENV)

    expect(swept.dispatched).toBeGreaterThanOrEqual(1)
    expect(triggered.map((t) => t.input)).toContainEqual(inputFor(jobId))
  })
})
