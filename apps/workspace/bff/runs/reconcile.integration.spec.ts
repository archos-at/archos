/**
 * Opt-in integration test: the run reconciler's two statements against a REAL
 * Postgres with every migration applied (0096 included), as the restricted
 * runtime role.
 *
 * The unit suite doubles the repository and pins the decisions. Only this can
 * prove the SQL: that the claim picks exactly the active runs nobody has
 * checked within the window, stamps them in the same statement so a second
 * sweep — or a second replica sweeping at the same moment — never takes one
 * run twice, and that the conditional close lets exactly one closer win. And
 * the ledger heal (migration 0099): a run whose row closed by a path that never
 * reached its block is claimed once, and its block — a real message, written
 * through the lock-held merge — ends.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/runs/reconcile.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs it.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { emptySkillSnapshot } from '@/lib/jobs/types'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL

const STAMP = Date.now()
const ORG = `org_reconcile_${STAMP}`
const OTHER_ORG = `org_reconcile_other_${STAMP}`
const USER = `user_reconcile_${STAMP}`
const PROJECT = '0c0c0c0c-0000-4000-8000-000000000001'
const OTHER_PROJECT = '0c0c0c0c-0000-4000-8000-000000000002'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

describe.skipIf(!url)('run reconciler SQL against live Postgres (migration 0096)', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let repository: typeof import('@/lib/tasks/repository')

  const ids: Record<string, string> = {}
  const ours = <T extends { id: string }>(rows: T[]): T[] => {
    const mine = new Set(Object.values(ids))
    return rows.filter((row) => mine.has(row.id))
  }
  const nameOf = (id: string) => Object.entries(ids).find(([, value]) => value === id)?.[0]

  async function seedRun(
    name: string,
    organizationId: string,
    projectId: string,
    fields: { status: 'queued' | 'running' | 'succeeded'; startedAt: Date | null; createdAt: Date },
  ) {
    const run = await withTenant({ organizationId }, () =>
      repository.insertRun({
        organizationId,
        projectId,
        kind: 'deep-research',
        title: name,
        plan: { prompt: name, skill: emptySkillSnapshot(), dataSources: null, goal: name, subject: null },
        requesterUserId: USER,
        trigger: 'delegated',
        status: fields.status,
        skillSnapshot: emptySkillSnapshot(),
        backendJobId: `job_${name}_${STAMP}`,
        startedAt: fields.startedAt,
        createdAt: fields.createdAt,
      }),
    )
    ids[name] = run.id
  }

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    repository = await import('@/lib/tasks/repository')
    db = (await import('@/lib/db')).getDb()

    await withPlatformAccess('test seed: organizations', async () => {
      for (const org of [ORG, OTHER_ORG]) {
        await db.execute(
          sql`insert into organizations (workos_organization_id, display_name) values (${org}, ${org}) on conflict do nothing`,
        )
      }
    })
    for (const [org, project] of [
      [ORG, PROJECT],
      [OTHER_ORG, OTHER_PROJECT],
    ] as const) {
      await withTenant({ organizationId: org }, () =>
        db.execute(sql`
          insert into projects (id, organization_id, name, created_by, collection_name)
          values (${project}, ${org}, 'Reconcile', ${USER}, ${'proj_' + project})
        `),
      )
    }

    await seedRun('stale', ORG, PROJECT, { status: 'running', startedAt: minutesAgo(30), createdAt: minutesAgo(31) })
    await seedRun('fresh', ORG, PROJECT, { status: 'running', startedAt: minutesAgo(2), createdAt: minutesAgo(2) })
    await seedRun('done', ORG, PROJECT, { status: 'succeeded', startedAt: minutesAgo(60), createdAt: minutesAgo(60) })
    // Never started: judged by when it was created.
    await seedRun('queued', ORG, PROJECT, { status: 'queued', startedAt: null, createdAt: minutesAgo(45) })
    await seedRun('elsewhere', OTHER_ORG, OTHER_PROJECT, {
      status: 'running',
      startedAt: minutesAgo(20),
      createdAt: minutesAgo(20),
    })
  })

  afterAll(async () => {
    if (!db) return
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`delete from projects where organization_id in (${ORG}, ${OTHER_ORG})`)
      await db.execute(
        sql`delete from organizations where workos_organization_id in (${ORG}, ${OTHER_ORG})`,
      )
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('claims only active runs older than the window, across organizations, oldest first', async () => {
    const claimed = await withPlatformAccess('test: claim', () =>
      repository.claimRunsToReconcile(minutesAgo(10), 500),
    )
    const mine = ours(claimed)
    expect(mine.map((row) => nameOf(row.id)).sort()).toEqual(['elsewhere', 'queued', 'stale'])
    for (const row of mine) {
      expect(row.reconcileCheckedAt).toBeInstanceOf(Date)
      expect(Date.now() - (row.reconcileCheckedAt as Date).getTime()).toBeLessThan(60_000)
    }
  })

  it('does not take a run again until the window has passed since its last check', async () => {
    const again = await withPlatformAccess('test: claim again', () =>
      repository.claimRunsToReconcile(minutesAgo(10), 500),
    )
    expect(ours(again)).toEqual([])

    // A cutoff in the future stands in for the window having passed.
    const later = await withPlatformAccess('test: claim later', () =>
      repository.claimRunsToReconcile(new Date(Date.now() + 60_000), 500),
    )
    expect(ours(later).map((row) => nameOf(row.id)).sort()).toEqual(['elsewhere', 'fresh', 'queued', 'stale'])
  })

  it('two sweeps at the same moment never take the same run', async () => {
    // Due again, as they would be once the window has passed — and a cutoff in
    // the PAST, as a real sweep uses, so a run one sweep has just stamped is out
    // of the other's window whether it saw the lock or the committed stamp.
    await withPlatformAccess('test: make due again', () =>
      db.execute(sql`update task_runs set reconcile_checked_at = null where organization_id in (${ORG}, ${OTHER_ORG})`),
    )
    const cutoff = minutesAgo(1)
    const [a, b] = await Promise.all([
      withPlatformAccess('test: replica a', () => repository.claimRunsToReconcile(cutoff, 500)),
      withPlatformAccess('test: replica b', () => repository.claimRunsToReconcile(cutoff, 500)),
    ])
    const taken = [...ours(a), ...ours(b)].map((row) => row.id)
    expect(new Set(taken).size).toBe(taken.length)
    expect(taken.length).toBe(4)
  })

  it('bounds a sweep by its batch', async () => {
    const future = new Date(Date.now() + 20 * 60_000)
    const one = await withPlatformAccess('test: batch', () => repository.claimRunsToReconcile(future, 1))
    expect(one.length).toBe(1)
  })

  it('closes a run once: the second closer, and another organization, get nothing', async () => {
    const patch = { status: 'failed' as const, error: 'reconciled' }

    const foreign = await withTenant({ organizationId: OTHER_ORG }, () =>
      repository.closeActiveRun(ids.stale, OTHER_ORG, patch),
    )
    expect(foreign).toBeNull()

    const first = await withTenant({ organizationId: ORG }, () => repository.closeActiveRun(ids.stale, ORG, patch))
    expect(first?.status).toBe('failed')

    const second = await withTenant({ organizationId: ORG }, () => repository.closeActiveRun(ids.stale, ORG, patch))
    expect(second).toBeNull()

    const finished = await withTenant({ organizationId: ORG }, () =>
      repository.closeActiveRun(ids.done, ORG, patch),
    )
    expect(finished).toBeNull()

    // And a closed run leaves the sweep for good.
    const after = await withPlatformAccess('test: claim after close', () =>
      repository.claimRunsToReconcile(new Date(Date.now() + 60 * 60_000), 500),
    )
    expect(ours(after).map((row) => nameOf(row.id))).not.toContain('stale')
  })

  it('heals, once, the block of a run the reaper closed by its row alone', async () => {
    const { insertConversation, findMessageInConversation } = await import('@/lib/conversations/repository')
    const runs = await import('@/lib/runs/service')
    const { endingOfClosedRun } = await import('@/lib/runs/reconcile')
    const conversationId = `s_conv_heal_${STAMP}`

    await withTenant({ organizationId: ORG }, () =>
      insertConversation({ id: conversationId, organizationId: ORG, createdBy: USER, title: 'Heal', projectId: PROJECT }),
    )
    await seedRun('ghost', ORG, PROJECT, { status: 'running', startedAt: minutesAgo(40), createdAt: minutesAgo(40) })
    const messageId = await withTenant({ organizationId: ORG }, async () => {
      const message = await runs.createRunMessage(conversationId, ids.ghost, { at: minutesAgo(40) })
      await repository.updateRun(ids.ghost, ORG, { conversationId, runMessageId: message.id })
      return message.id
    })
    await runs.applyRunLedgerOp(ids.ghost, {
      op: 'append',
      phases: [{ phase: 'researching', startedAt: minutesAgo(39).toISOString() }],
    })

    // The ghost reaper's report: the row closes, the block hears nothing.
    await withTenant({ organizationId: ORG }, () =>
      repository.closeActiveRun(ids.ghost, ORG, { status: 'failed', error: 'Job timed out' }),
    )

    const claimed = await withPlatformAccess('test: heal claim', () => repository.claimClosedRunsToHeal(500))
    // Only runs with a block: 'stale' and 'done' closed too, but have no message.
    expect(ours(claimed).map((row) => nameOf(row.id))).toEqual(['ghost'])

    const [ghost] = ours(claimed)
    const healed = await withTenant({ organizationId: ORG }, () =>
      runs.settleRunLedger(ghost, endingOfClosedRun(ghost)),
    )
    expect(healed).toBe(true)
    const message = await withTenant({ organizationId: ORG }, () =>
      findMessageInConversation(conversationId, messageId),
    )
    const ledger = (message?.metadata as Record<string, { status: string; error?: { reason: string } }>).run_ledger
    expect(ledger.status).toBe('failed')
    expect(ledger.error?.reason).toBe('Job timed out')

    // Looked at once: the stamp moved it past its ending.
    const again = await withPlatformAccess('test: heal claim again', () => repository.claimClosedRunsToHeal(500))
    expect(ours(again)).toEqual([])
    // A heal that failed hands its claim back: the run is due on the next sweep.
    await withTenant({ organizationId: ORG }, () => repository.releaseHealClaim(ids.ghost))
    const released = await withPlatformAccess('test: heal claim after release', () =>
      repository.claimClosedRunsToHeal(500),
    )
    expect(ours(released).map((row) => nameOf(row.id))).toEqual(['ghost'])
    // And a second settle of an ended block writes nothing.
    expect(await withTenant({ organizationId: ORG }, () => runs.settleRunLedger(ghost, { status: 'success' }))).toBe(
      false,
    )
  })

  /** A run with its message in a thread of its own, as a submit leaves it. */
  async function seedRunWithBlock(name: string, status: 'queued' | 'running') {
    const { insertConversation } = await import('@/lib/conversations/repository')
    const runs = await import('@/lib/runs/service')
    const conversationId = `s_conv_${name}_${STAMP}`
    await withTenant({ organizationId: ORG }, () =>
      insertConversation({ id: conversationId, organizationId: ORG, createdBy: USER, title: name, projectId: PROJECT }),
    )
    await seedRun(name, ORG, PROJECT, { status, startedAt: minutesAgo(5), createdAt: minutesAgo(5) })
    await withTenant({ organizationId: ORG }, async () => {
      const message = await runs.createRunMessage(conversationId, ids[name], { at: minutesAgo(5) })
      await repository.updateRun(ids[name], ORG, { conversationId, runMessageId: message.id })
    })
  }

  it('the kill switch’s claim leaves out a run whose block already reads done', async () => {
    const runs = await import('@/lib/runs/service')
    const { claimRunsToInterrupt } = await import('@/lib/tasks/run-moves')
    // The worker stored its report and said so on the block; only its outcome
    // report, which closes the row, has not arrived.
    await seedRunWithBlock('reported', 'running')
    await runs.applyRunLedgerOp(ids.reported, { op: 'finish', result: { filedAt: new Date().toISOString() } })
    await seedRunWithBlock('working', 'running')
    await runs.applyRunLedgerOp(ids.working, {
      op: 'append',
      phases: [{ phase: 'researching', startedAt: minutesAgo(4).toISOString() }],
    })
    await seedRun('blockless', ORG, PROJECT, { status: 'queued', startedAt: null, createdAt: minutesAgo(1) })

    const claimed = await withPlatformAccess('test: kill claim', () => claimRunsToInterrupt(500))
    const names = ours(claimed).map((row) => nameOf(row.id))

    expect(names).toEqual(expect.arrayContaining(['working', 'blockless']))
    expect(names).not.toContain('reported')
    // Not stamped either: the reconciler finds it by its own age and closes it
    // from the job store when the worker's report never comes.
    const [reported] = ours(
      await withPlatformAccess('test: reconcile claim', () =>
        repository.claimRunsToReconcile(new Date(Date.now() + 60_000), 500),
      ),
    ).filter((row) => row.id === ids.reported)
    expect(reported?.status).toBe('running')
  })

  it('a submit records its job on any row, and moves the status only from queued to running', async () => {
    const { recordSubmission } = await import('@/lib/tasks/run-moves')
    const submission = (name: string, status: 'queued' | 'running') => ({
      status,
      backendJobId: `job_submitted_${name}_${STAMP}`,
      conversationId: null,
      runMessageId: null,
    })
    const record = (name: string, status: 'queued' | 'running', organizationId = ORG) =>
      withTenant({ organizationId }, () => recordSubmission(ids[name], organizationId, submission(name, status)))

    // The kill switch closed the queued row while the submit was out.
    await seedRun('killed', ORG, PROJECT, { status: 'queued', startedAt: null, createdAt: minutesAgo(1) })
    await withTenant({ organizationId: ORG }, () =>
      repository.closeActiveRun(ids.killed, ORG, { status: 'interrupted', error: 'Abgebrochen.' }),
    )
    const killed = await record('killed', 'running')
    expect(killed).toMatchObject({ status: 'interrupted', error: 'Abgebrochen.', startedAt: null })
    expect(killed?.backendJobId).toBe(`job_submitted_killed_${STAMP}`)

    // The worker's first flush started the run before the submit returned `queued`.
    const startedAt = minutesAgo(1)
    await seedRun('flushed', ORG, PROJECT, { status: 'running', startedAt, createdAt: minutesAgo(2) })
    const flushed = await record('flushed', 'queued')
    expect(flushed).toMatchObject({ status: 'running', backendJobId: `job_submitted_flushed_${STAMP}` })
    expect(flushed?.startedAt?.getTime()).toBe(startedAt.getTime())

    // The ordinary case: a queued row whose job started at once.
    await seedRun('taken', ORG, PROJECT, { status: 'queued', startedAt: null, createdAt: minutesAgo(1) })
    const taken = await record('taken', 'running')
    expect(taken?.status).toBe('running')
    expect(taken?.startedAt).toBeInstanceOf(Date)

    // And one the backend queued stays queued and unstarted.
    await seedRun('held', ORG, PROJECT, { status: 'queued', startedAt: null, createdAt: minutesAgo(1) })
    expect(await record('held', 'queued')).toMatchObject({ status: 'queued', startedAt: null })

    expect(await record('held', 'running', OTHER_ORG)).toBeNull()
  })

  it('heals a run closed by a pod whose clock lags the database’s', async () => {
    // The claim stamps `reconcile_checked_at` with the database's clock. The
    // close used to stamp `finished_at` with the pod's, so behind a lagging pod
    // the run ended "before" it was last looked at and the heal never took it.
    await seedRun('lagging', ORG, PROJECT, { status: 'running', startedAt: minutesAgo(30), createdAt: minutesAgo(30) })
    await withTenant({ organizationId: ORG }, () =>
      repository.updateRun(ids.lagging, ORG, { runMessageId: '0c0c0c0c-0000-4000-8000-0000000000aa' }),
    )
    await withPlatformAccess('test: the reconciler looks at it', () =>
      repository.claimRunsToReconcile(new Date(Date.now() + 60_000), 500),
    )

    const realNow = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(realNow - 60 * 60_000))
    let closed: Awaited<ReturnType<typeof repository.closeActiveRun>>
    try {
      closed = await withTenant({ organizationId: ORG }, () =>
        repository.closeActiveRun(ids.lagging, ORG, { status: 'failed', error: 'Job timed out' }),
      )
    } finally {
      vi.useRealTimers()
    }

    // A date for every reader of the returned row, and the database's.
    expect(closed?.finishedAt).toBeInstanceOf(Date)
    expect(Math.abs((closed?.finishedAt as Date).getTime() - realNow)).toBeLessThan(60_000)
    const healable = await withPlatformAccess('test: heal claim', () => repository.claimClosedRunsToHeal(500))
    expect(ours(healable).map((row) => nameOf(row.id))).toContain('lagging')
  })
})
