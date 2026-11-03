/**
 * @vitest-environment node
 *
 * Taking a definition's occurrence (`advanceDueDefinition`) against a real
 * Postgres as `app_rw`, the replacement of the scheduler's `claimDue` proof:
 * each due occurrence is taken once, however many fires race for it, and the
 * repair scan finds what is overdue.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/scheduling/repository.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs it.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now()
const ORG = `org_scheduling_${STAMP}`
const DUE = new Date('2026-01-05T08:00:00.000Z')
const NEXT = new Date('2026-01-12T08:00:00.000Z')

describe('the suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('taking a due occurrence against Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let repo: typeof import('./repository')
  let projectId = ''

  const inTenant = <T>(run: () => Promise<T>): Promise<T> => withTenant({ organizationId: ORG }, run)

  async function insertDefinition(trigger: 'schedule' | 'once', nextRunAt: Date | string): Promise<string> {
    const rows = await inTenant(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO task_definitions
          (organization_id, project_id, kind, title, plan, requester_user_id, trigger, enabled, schedule_cron, schedule_timezone, next_run_at, due_at)
        VALUES (${ORG}, ${projectId}::uuid, 'deep-research', 'Wochenbericht',
                ${JSON.stringify({ prompt: 'p', skill: {}, dataSources: null })}::jsonb,
                'user_1', ${trigger}, true, ${trigger === 'schedule' ? '0 9 * * 1' : null}, 'Europe/Vienna',
                ${typeof nextRunAt === 'string' ? sql.raw(nextRunAt) : sql`${nextRunAt.toISOString()}::timestamptz`},
                ${trigger === 'once' ? sql`${DUE.toISOString()}::timestamptz` : null})
        RETURNING id`)
    )
    return String(Array.from(rows)[0]?.id)
  }

  const advance = (id: string, dueAt: Date, nextRunAt: Date | null = NEXT) =>
    inTenant(() => repo.advanceDueDefinition(id, ORG, dueAt, () => ({ nextRunAt, enabled: true, fire: true })))

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    ;({ withTenant, withPlatformAccess } = await import('@/lib/db/tenant-context'))
    db = (await import('@/lib/db')).getDb()
    repo = await import('./repository')
    const rows = await inTenant(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO projects (organization_id, name, created_by, collection_name)
        VALUES (${ORG}, 'Seestadt D12', 'user_1', ${`proj_scheduling_${STAMP}`}) RETURNING id`)
    )
    projectId = String(Array.from(rows)[0]?.id)
  })

  afterAll(async () => {
    if (!url) return
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`DELETE FROM task_definitions WHERE organization_id = ${ORG}`)
      await db.execute(sql`DELETE FROM projects WHERE organization_id = ${ORG}`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('takes an occurrence once: the second fire of the same due time records nothing', async () => {
    const id = await insertDefinition('schedule', DUE)

    const first = await advance(id, DUE)
    const second = await advance(id, DUE)

    expect(first?.definition.nextRunAt?.toISOString()).toBe(NEXT.toISOString())
    expect(second).toBeNull()
  })

  it('gives one occurrence to exactly one of several racing fires', async () => {
    const id = await insertDefinition('schedule', DUE)

    const results = await Promise.all([advance(id, DUE), advance(id, DUE), advance(id, DUE)])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('matches a due time SQL wrote with microseconds against the millisecond time a task input carries', async () => {
    const id = await insertDefinition('once', "'2026-01-05 08:00:00.123456+00'::timestamptz")

    const taken = await advance(id, new Date('2026-01-05T08:00:00.123Z'), null)

    expect(taken?.definition.nextRunAt).toBeNull()
    expect(taken?.definition.enabled).toBe(true)
  })

  it('refuses a fire for a due time the row no longer holds, and a paused row', async () => {
    const moved = await insertDefinition('schedule', NEXT)
    const paused = await insertDefinition('schedule', DUE)
    await inTenant(() => db.execute(sql`UPDATE task_definitions SET enabled = false WHERE id = ${paused}::uuid`))

    expect(await advance(moved, DUE)).toBeNull()
    expect(await advance(paused, DUE)).toBeNull()
  })

  it('finds an overdue row across organizations, and records the scheduled run it is given', async () => {
    const id = await insertDefinition('schedule', new Date(Date.now() - 10 * 60_000))

    const overdue = await repo.findOverdueDefinitions(3, 500)
    expect(overdue.map((row) => row.id)).toContain(id)

    await inTenant(() => repo.setScheduledRunId(id, ORG, 'run_1'))
    const [row] = await inTenant(() => db.execute<{ scheduled_run_id: string }>(sql`SELECT scheduled_run_id FROM task_definitions WHERE id = ${id}::uuid`))
    expect(row?.scheduled_run_id).toBe('run_1')
  })
})
