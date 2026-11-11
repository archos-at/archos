/**
 * @vitest-environment node
 *
 * A run's question to a person (`run_input_requests`, migration 0234,
 * ADR-0181) against a REAL Postgres through the restricted runtime role:
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/runs/input-requests.integration.spec.ts
 *
 * `task db:test:rls` (scripts/rls-test-db.sh) builds that database and runs it.
 *
 * Proven here, where a mock proves nothing: a retried question is one row, the
 * first final word stands at the write, the CHECKs refuse a row the lifecycle
 * could not have produced, the list pages without a gap, and another
 * organization neither reads a request nor plants one on this run.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RequestedSchema } from './input-request-types'

vi.mock('server-only', () => ({}))

const STAMP = Date.now()
const ORG = `org_input_${STAMP}`
const OTHER_ORG = `${ORG}_other`
const USER = `user_input_${STAMP}`
const url = process.env.TEST_DATABASE_URL

const SCHEMA: RequestedSchema = { type: 'object', properties: { scale: { type: 'string', enum: ['1:100', '1:200'] } }, required: ['scale'] }

describe.skipIf(!url)('run input requests against Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let repo: typeof import('./input-request-repository')
  const ids = { project: '', run: '', otherRun: '', foreignProject: '', foreignRun: '' }

  const inOrg = <T>(organizationId: string, run: () => PromiseLike<T>) => withTenant({ organizationId, userId: USER }, run)
  const first = async (rows: PromiseLike<Iterable<{ id: string }>>) => String(Array.from(await rows)[0]?.id)

  const project = (organizationId: string, name: string) =>
    first(
      inOrg(organizationId, () =>
        db.execute<{ id: string }>(sql`
          insert into projects (organization_id, name, created_by, collection_name)
          values (${organizationId}, ${name}, ${USER}, ${`proj_input_${name}_${STAMP}`}) returning id`)
      )
    )

  const taskRun = (organizationId: string, projectId: string) =>
    first(
      inOrg(organizationId, () =>
        db.execute<{ id: string }>(sql`
          insert into task_runs (organization_id, project_id, kind, title, plan, requester_user_id, trigger, status, skill_snapshot)
          values (${organizationId}, ${projectId}::uuid, 'document', 'Aktenvermerk',
                  '{"prompt":"Schreibe","skill":{},"dataSources":null}'::jsonb, ${USER}, 'delegated', 'running', '{}'::jsonb)
          returning id`)
      )
    )

  const key = () => ({ organizationId: ORG, runId: ids.run })
  const ask = (idempotencyKey: string, runId = ids.run, expiresAt: Date | null = null) =>
    repo.insertOrFind({
      organizationId: ORG,
      projectId: ids.project,
      runId,
      idempotencyKey,
      reason: 'confirmation',
      message: 'Is 1:100 the scale of the floor plan on page 1?',
      requestedSchema: SCHEMA,
      expiresAt,
    })

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    withTenant = (await import('@/lib/db/tenant-context')).withTenant
    db = (await import('@/lib/db')).getDb()
    repo = await import('./input-request-repository')
    ids.project = await project(ORG, 'own')
    ids.run = await taskRun(ORG, ids.project)
    ids.otherRun = await taskRun(ORG, ids.project)
    ids.foreignProject = await project(OTHER_ORG, 'foreign')
    ids.foreignRun = await taskRun(OTHER_ORG, ids.foreignProject)
  })

  afterAll(async () => {
    if (!db) return
    for (const organizationId of [ORG, OTHER_ORG]) {
      await inOrg(organizationId, () => db.execute(sql`delete from task_runs where organization_id = ${organizationId}`))
      await inOrg(organizationId, () => db.execute(sql`delete from projects where organization_id = ${organizationId}`))
    }
  })

  it('stores a retried question once', async () => {
    const one = await ask('scale:page-1')
    const two = await ask('scale:page-1')
    expect(one.created).toBe(true)
    expect(two.created).toBe(false)
    expect(two.row.id).toBe(one.row.id)
    expect(await repo.countOpen(key())).toBe(1)
  })

  it('lets the first final word stand at the write', async () => {
    const { row } = await ask('scale:page-2')
    const at = new Date()
    const answered = await repo.decide(key(), row.id, { event: 'answer', content: { scale: '1:200' } }, USER, at)
    expect(answered).toMatchObject({ status: 'answered', content: { scale: '1:200' }, decidedBy: USER })
    expect(await repo.decide(key(), row.id, { event: 'decline' }, USER, at)).toBeNull()
    expect(await repo.findInRun(key(), row.id)).toMatchObject({ status: 'answered' })
  })

  it('refuses a row the lifecycle could not have produced', async () => {
    const { row } = await ask('scale:page-3')
    const raw = (statement: ReturnType<typeof sql>) => inOrg(ORG, () => db.execute(statement))
    // Answered with no answer, decided with no time, a person named on a request the clock closed.
    await expect(raw(sql`update run_input_requests set status = 'answered', decided_at = now(), decided_by = ${USER} where id = ${row.id}::uuid`)).rejects.toThrow()
    await expect(raw(sql`update run_input_requests set status = 'declined', decided_by = ${USER} where id = ${row.id}::uuid`)).rejects.toThrow()
    await expect(raw(sql`update run_input_requests set status = 'expired', decided_at = now(), decided_by = ${USER} where id = ${row.id}::uuid`)).rejects.toThrow()
    await expect(raw(sql`update run_input_requests set status = 'paused' where id = ${row.id}::uuid`)).rejects.toThrow()
    expect(await repo.findInRun(key(), row.id)).toMatchObject({ status: 'open' })
  })

  it('expires what is past its deadline and cancels the rest when the run ends', async () => {
    const run = { organizationId: ORG, runId: ids.otherRun }
    const due = await ask('due', ids.otherRun, new Date(Date.now() - 60_000))
    const open = await ask('open', ids.otherRun)
    expect(await repo.expireDue(run, new Date())).toBe(1)
    expect(await repo.findInRun(run, due.row.id)).toMatchObject({ status: 'expired', decidedBy: null })
    expect(await repo.cancelOpen(run, new Date())).toBe(1)
    expect(await repo.findInRun(run, open.row.id)).toMatchObject({ status: 'cancelled', decidedBy: null })
    expect(await repo.countOpen(run)).toBe(0)
  })

  it('pages newest first without a gap or a repeat', async () => {
    const firstPage = await repo.listForRun(key(), { limit: 2, cursor: null })
    const secondPage = await repo.listForRun(key(), { limit: 2, cursor: firstPage.next })
    const seen = [...firstPage.rows, ...secondPage.rows].map((row) => row.id)
    expect(firstPage.next).not.toBeNull()
    expect(secondPage.next).toBeNull()
    expect(new Set(seen).size).toBe(3)
  })

  it('shows another organization nothing, and lets it plant nothing on this run', async () => {
    const foreign = { organizationId: OTHER_ORG, runId: ids.run }
    expect(await repo.countOpen(foreign)).toBe(0)
    expect((await repo.listForRun(foreign, { limit: 10, cursor: null })).rows).toEqual([])
    await expect(
      repo.insertOrFind({
        organizationId: OTHER_ORG,
        projectId: ids.foreignProject,
        runId: ids.run,
        idempotencyKey: 'planted',
        reason: 'input_required',
        message: 'planted',
        requestedSchema: SCHEMA,
        expiresAt: null,
      })
    ).rejects.toThrow()
  })

  it('goes with its run', async () => {
    await inOrg(ORG, () => db.execute(sql`delete from task_runs where id = ${ids.otherRun}::uuid`))
    expect((await repo.listForRun({ organizationId: ORG, runId: ids.otherRun }, { limit: 10, cursor: null })).rows).toEqual([])
  })
})
