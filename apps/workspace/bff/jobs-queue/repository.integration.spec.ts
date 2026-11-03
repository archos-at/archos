/**
 * @vitest-environment node
 *
 * The BFF's side of `bff_job_queue`, against a REAL Postgres, through the
 * restricted runtime role: a request enqueues into its own lane, a second
 * click finds the open job by its payload, and a `bff-job` run takes, saves,
 * fails and finishes only the row it holds (ADR-0150).
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/jobs-queue/repository.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs it.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now()
const ORG_A = `org_jobrepo_a_${STAMP}`
const ORG_B = `org_jobrepo_b_${STAMP}`

describe.skipIf(!url)('bff_job_queue reads and writes from the BFF', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let context: typeof import('@/lib/db/tenant-context')
  let repo: typeof import('./repository')

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    context = await import('@/lib/db/tenant-context')
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await context.withPlatformAccess('test teardown', async () => {
      await db.execute(sql`DELETE FROM bff_job_queue WHERE lane IN (${ORG_A}, ${ORG_B})`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  const enqueueAs = (organizationId: string, projectId: string, kind = 'reindex_project') =>
    context.withTenant({ organizationId }, () =>
      repo.insertJob({ kind, organizationId, priority: 1, payload: { projectId, cursor: null } }),
    )

  it('enqueues into the active organization’s lane, queued and unclaimed', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-1')

    const rows = await context.withPlatformAccess('test: read the row', () =>
      db.execute<Record<string, unknown>>(sql`SELECT * FROM bff_job_queue WHERE job_id = ${jobId}::uuid`),
    )
    expect(Array.from(rows)[0]).toMatchObject({
      lane: ORG_A,
      kind: 'reindex_project',
      priority: 1,
      status: 'queued',
      attempts: 0,
      claimed_by: null,
      payload: { projectId: 'p-1', cursor: null },
    })
  })

  it('refuses a lane that is not the active organization', async () => {
    const forged = context.withTenant({ organizationId: ORG_A }, () =>
      repo.insertJob({ kind: 'reindex_project', organizationId: ORG_B, priority: 1, payload: {} }),
    )

    await expect(forged).rejects.toThrow()
  })

  it('finds the open job of a kind by what its payload contains, in the caller’s lane only', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-open')
    await enqueueAs(ORG_B, 'p-open')

    const inA = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.findOpenJobId({ kind: 'reindex_project', organizationId: ORG_A, matching: { projectId: 'p-open' } }),
    )
    const otherProject = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.findOpenJobId({ kind: 'reindex_project', organizationId: ORG_A, matching: { projectId: 'p-none' } }),
    )
    const otherKind = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.findOpenJobId({ kind: 'reingest_failed', organizationId: ORG_A, matching: { projectId: 'p-open' } }),
    )
    const anyOfKind = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.findOpenJobId({ kind: 'reindex_project', organizationId: ORG_A, matching: {} }),
    )

    expect(inA).toBe(jobId)
    expect(otherProject).toBeNull()
    expect(otherKind).toBeNull()
    expect(anyOfKind).not.toBeNull()
  })

  it('does not call a dead job open', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-dead')
    await context.withPlatformAccess('test: kill the job', () =>
      db.execute(sql`UPDATE bff_job_queue SET status = 'dead', dead_at = now(), last_error = 'x' WHERE job_id = ${jobId}::uuid`),
    )

    const open = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.findOpenJobId({ kind: 'reindex_project', organizationId: ORG_A, matching: { projectId: 'p-dead' } }),
    )

    expect(open).toBeNull()
  })

  it('finds only a job no worker has claimed yet when asked for one not started', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-started')
    const find = () =>
      context.withTenant({ organizationId: ORG_A }, () =>
        repo.findOpenJobId({ kind: 'reindex_project', organizationId: ORG_A, matching: { projectId: 'p-started' }, notStarted: true }),
      )
    expect(await find()).toBe(jobId)

    await context.withPlatformAccess('test: a worker claims the job', () =>
      db.execute(sql`UPDATE bff_job_queue SET status = 'claimed', claimed_by = 'w-1', claimed_at = now(), heartbeat_at = now() WHERE job_id = ${jobId}::uuid`),
    )

    expect(await find()).toBeNull()
    const open = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.findOpenJobId({ kind: 'reindex_project', organizationId: ORG_A, matching: { projectId: 'p-started' } }),
    )
    expect(open).toBe(jobId)
  })

  it('finds the newest dead job of a kind by its payload, in the caller’s lane only, with its reason', async () => {
    const dead = await enqueueAs(ORG_A, 'p-gave-up', 'bim_extract')
    await enqueueAs(ORG_A, 'p-gave-up', 'bim_extract') // still queued: not dead
    await enqueueAs(ORG_B, 'p-gave-up', 'bim_extract')
    await context.withPlatformAccess('test: bury the job', () =>
      db.execute(sql`UPDATE bff_job_queue SET status = 'dead', dead_at = now(), last_error = 'object store down' WHERE job_id = ${dead}::uuid`),
    )

    const found = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.findDeadJob({ kind: 'bim_extract', organizationId: ORG_A, matching: { projectId: 'p-gave-up' } }),
    )
    const none = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.findDeadJob({ kind: 'bim_extract', organizationId: ORG_A, matching: { projectId: 'p-never' } }),
    )

    expect(found).toEqual({ jobId: dead, lastError: 'object store down' })
    expect(none).toBeNull()
  })

  const platform = <T>(fn: () => Promise<T>) => context.withPlatformAccess('test: a run', fn)
  const status = async (jobId: string) => {
    const rows = await platform(() =>
      db.execute<Record<string, unknown>>(sql`SELECT status, attempts, claimed_by, payload, last_error FROM bff_job_queue WHERE job_id = ${jobId}::uuid`),
    )
    return Array.from(rows)[0] ?? null
  }

  const age = (jobId: string, columns: { claimedMinutes: number; heartbeatMinutes: number }) =>
    platform(() =>
      db.execute(sql`
        UPDATE bff_job_queue SET
          claimed_at = now() - make_interval(mins => ${columns.claimedMinutes}),
          heartbeat_at = now() - make_interval(mins => ${columns.heartbeatMinutes})
        WHERE job_id = ${jobId}::uuid`),
    )

  it('lets one attempt take a job, and no other, not even one under the same name, until it goes silent', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-take')

    expect((await platform(() => repo.takeJob(jobId, 'run-1/0', { staleSeconds: 600 })))?.attempts).toBe(1)
    expect(await platform(() => repo.takeJob(jobId, 'run-1/1', { staleSeconds: 600 }))).toBeNull()
    // A reassigned copy of the same attempt does not match the claim either.
    expect(await platform(() => repo.takeJob(jobId, 'run-1/0', { staleSeconds: 600 }))).toBeNull()
    // Silent past the stale window, it has lost the row, and its writes are refused.
    await age(jobId, { claimedMinutes: 20, heartbeatMinutes: 20 })
    expect((await platform(() => repo.takeJob(jobId, 'run-1/1', { staleSeconds: 600 })))?.claimedBy).toBe('run-1/1')
    expect(await platform(() => repo.finishJob(jobId, 'run-1/0'))).toBe(false)
    expect(await platform(() => repo.finishJob(jobId, 'run-1/1'))).toBe(true)
    expect(await status(jobId)).toBeNull()
  })

  it('keeps a row whose holder beats, refreshed only by that holder', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-beat')
    await platform(() => repo.takeJob(jobId, 'run-beat/0', { staleSeconds: 600 }))
    await age(jobId, { claimedMinutes: 20, heartbeatMinutes: 20 })

    expect(await platform(() => repo.heartbeatJob(jobId, 'run-other/0'))).toBe(false)
    expect(await platform(() => repo.heartbeatJob(jobId, 'run-beat/0'))).toBe(true)

    expect(await platform(() => repo.takeJob(jobId, 'run-other/0', { staleSeconds: 600 }))).toBeNull()
    const listed = await platform(() => repo.listJobsToDispatch({ graceSeconds: 0, staleSeconds: 600, limit: 500 }))
    expect(listed.map((row) => row.jobId)).not.toContain(jobId)
  })

  it('leaves a row the claim loop before Hatchet still works on: an old take with a fresh heartbeat is alive', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-rollout')
    // The old loop held one take across many slices and refreshed only heartbeat_at.
    await platform(() =>
      db.execute(sql`UPDATE bff_job_queue SET status = 'claimed', claimed_by = 'bff-jobs-old-pod', claimed_at = now(), heartbeat_at = now(), attempts = 1 WHERE job_id = ${jobId}::uuid`),
    )
    await age(jobId, { claimedMinutes: 45, heartbeatMinutes: 0 })

    expect(await platform(() => repo.takeJob(jobId, 'run-new/0', { staleSeconds: 360 }))).toBeNull()
    const sweep = await platform(() => repo.listJobsToDispatch({ graceSeconds: 120, staleSeconds: 360, limit: 500 }))
    expect(sweep.map((row) => row.jobId)).not.toContain(jobId)

    // Once the old pod is gone, its heartbeat goes stale and the row is taken.
    await age(jobId, { claimedMinutes: 45, heartbeatMinutes: 10 })
    const stale = await platform(() => repo.listJobsToDispatch({ graceSeconds: 120, staleSeconds: 360, limit: 500 }))
    expect(stale.map((row) => row.jobId)).toContain(jobId)
    expect((await platform(() => repo.takeJob(jobId, 'run-new/0', { staleSeconds: 360 })))?.claimedBy).toBe('run-new/0')
  })

  it('gives back the rows a stopping pod holds, in one guarded update, for the next run to take at once', async () => {
    const mine = await enqueueAs(ORG_A, 'p-release-mine')
    const takenOver = await enqueueAs(ORG_A, 'p-release-taken')
    await platform(() => repo.takeJob(mine, 'run-a/0@w-1', { staleSeconds: 600 }))
    await platform(() => repo.takeJob(takenOver, 'run-b/0@w-2', { staleSeconds: 600 }))

    // This pod thinks it still holds `takenOver` as run-b/0@w-1: that holder is not on the row.
    const held = [
      { jobId: mine, holder: 'run-a/0@w-1' },
      { jobId: takenOver, holder: 'run-b/0@w-1' },
    ]
    expect(await platform(() => repo.releaseJobs(held))).toBe(1)
    expect(await platform(() => repo.releaseJobs(held))).toBe(0)
    expect(await platform(() => repo.releaseJobs([]))).toBe(0)

    expect(await status(mine)).toMatchObject({ status: 'queued', claimed_by: null, attempts: 1 })
    expect(await status(takenOver)).toMatchObject({ status: 'claimed', claimed_by: 'run-b/0@w-2' })
    // No stale window: Hatchet's retry takes it now, and the cut-off attempt can write nothing.
    expect((await platform(() => repo.takeJob(mine, 'run-a/1@w-3', { staleSeconds: 600 })))?.attempts).toBe(2)
    expect(await platform(() => repo.finishJob(mine, 'run-a/0@w-1'))).toBe(false)
  })

  it('tells a row that is not there from one that is', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-exists')

    expect(await platform(() => repo.jobExists(jobId))).toBe(true)
    expect(await platform(() => repo.jobExists('00000000-0000-4000-8000-000000000000'))).toBe(false)
  })

  it('saves a slice for the next run with its attempts back to none, and waits it out', async () => {
    const jobId = await enqueueAs(ORG_A, 'p-slice')
    await platform(() => repo.takeJob(jobId, 'run-1', { staleSeconds: 600 }))

    const saved = await platform(() => repo.saveJobProgress(jobId, 'run-1', { projectId: 'p-slice', cursor: 7 }, new Date(Date.now() + 3_600_000)))

    expect(saved?.claimedAt).toBeInstanceOf(Date)
    expect(await status(jobId)).toMatchObject({ status: 'queued', attempts: 0, claimed_by: null, payload: { projectId: 'p-slice', cursor: 7 } })
    // Not due for an hour: no run takes it, and the sweep does not dispatch it.
    expect(await platform(() => repo.takeJob(jobId, 'run-2', { staleSeconds: 600 }))).toBeNull()
    const stranded = await platform(() => repo.listJobsToDispatch({ graceSeconds: 0, staleSeconds: 600, limit: 500 }))
    expect(stranded.map((row) => row.jobId)).not.toContain(jobId)
  })

  it('queues a failed attempt behind its backoff, and makes the last one dead with ids only', async () => {
    const jobId = await context.withTenant({ organizationId: ORG_A }, () =>
      repo.insertJob({ kind: 'bim_extract', organizationId: ORG_A, priority: 0, payload: { projectId: 'p-fail', storageKey: 'k/plan.ifc' } }),
    )
    await platform(() => repo.takeJob(jobId, 'run-1/0', { staleSeconds: 600 }))
    expect(await platform(() => repo.failJob(jobId, 'run-1/0', new Error('blip'), { maxAttempts: 2, retryInSeconds: 0 }))).toBe('queued')

    await platform(() => repo.takeJob(jobId, 'run-1/1', { staleSeconds: 600 }))
    expect(await platform(() => repo.failJob(jobId, 'run-1/1', new Error('object store down'), { maxAttempts: 2, retryInSeconds: 0 }))).toBe('dead')

    expect(await status(jobId)).toMatchObject({ status: 'dead', payload: { projectId: 'p-fail' }, last_error: 'object store down' })
  })

  it('lists a queued row nobody dispatched, and a held row whose run went silent', async () => {
    const waiting = await enqueueAs(ORG_B, 'p-waiting')
    const held = await enqueueAs(ORG_B, 'p-held')
    await platform(() => repo.takeJob(held, 'run-gone', { staleSeconds: 600 }))
    await age(held, { claimedMinutes: 1, heartbeatMinutes: 1 })

    const listed = await platform(() => repo.listJobsToDispatch({ graceSeconds: 0, staleSeconds: 0, limit: 500 }))

    expect(listed.map((row) => row.jobId)).toEqual(expect.arrayContaining([waiting, held]))
    expect(listed.find((row) => row.jobId === held)?.claimedAt).toBeInstanceOf(Date)
  })
})
