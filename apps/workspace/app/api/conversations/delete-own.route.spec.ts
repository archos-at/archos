/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { ForbiddenError } from '@/lib/api/errors'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    email: 'user_1@example.test',
    organizationId: 'org_1',
    organizationMembershipId: 'om_1',
    role: 'member',
    permissions: [],
  }),
}))

const requireProjectAccessMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: requireProjectAccessMock,
}))

const enqueueJobMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/jobs-queue/enqueue', () => ({ enqueueJob: enqueueJobMock }))

const captured = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>)
const candidates = vi.hoisted(() => ({ rows: [] as unknown[][] }))
vi.mock('@/lib/db', () => {
  const db = drizzle(async (sql, params) => {
    captured.push({ sql, params })
    if (sql.startsWith('select')) return { rows: candidates.rows }
    if (sql.startsWith('update')) {
      return { rows: candidates.rows.filter((row) => row[2] !== true).map((row) => [row[0], row[1]]) }
    }
    return { rows: [] }
  })
  Object.assign(db, { transaction: (run: (tx: typeof db) => unknown) => run(db) })
  return { getDb: () => db }
})

import { DELETE } from './route'

const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const del = (query: string) => DELETE(new Request(`https://grid.example/api/conversations${query}`, { method: 'DELETE' }))

const selectOf = () => {
  const select = captured.find((entry) => entry.sql.startsWith('select'))
  expect(select).toBeDefined()
  return select!
}

describe('DELETE /api/conversations (delete all of my chats on one side)', () => {
  beforeEach(() => {
    captured.length = 0
    candidates.rows = []
    requireProjectAccessMock.mockReset()
    requireProjectAccessMock.mockResolvedValue({ role: 'project-viewer' })
    enqueueJobMock.mockReset()
    enqueueJobMock.mockResolvedValue({ jobId: 'job_1' })
  })

  it('refuses a request that names no side, so nothing is ever deleted by default', async () => {
    const res = await del('')
    expect(res.status).toBe(400)
    expect(captured).toHaveLength(0)
  })

  it('refuses a project side without its project, and a personal side with one', async () => {
    expect((await del('?place=project')).status).toBe(400)
    expect((await del(`?place=personal&projectId=${PROJECT_ID}`)).status).toBe(400)
    expect(captured).toHaveLength(0)
  })

  it('Persönlich selects only the caller’s own chats without a project, in the caller’s organization', async () => {
    const res = await del('?place=personal')

    expect(res.status).toBe(200)
    expect(requireProjectAccessMock).not.toHaveBeenCalled()
    const { sql, params } = selectOf()
    expect(sql).toContain('"conversations"."organization_id" = $')
    expect(sql).toContain('"conversations"."created_by" = $')
    expect(sql).toContain('"conversations"."project_id" is null')
    expect(sql).toContain('"conversations"."deleted_at" is null')
    expect(sql).toContain('"conversations"."job_id" is null')
    expect(params).toEqual(expect.arrayContaining(['org_1', 'user_1']))
  })

  it('a project checks the caller may see it and selects only the caller’s chats in it', async () => {
    const res = await del(`?place=project&projectId=${PROJECT_ID}`)

    expect(res.status).toBe(200)
    expect(requireProjectAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', organizationId: 'org_1' }),
      PROJECT_ID,
      'project:view'
    )
    const { sql, params } = selectOf()
    expect(sql).toContain('"conversations"."created_by" = $')
    expect(sql).toContain('"conversations"."project_id" = $')
    expect(sql).not.toContain('"conversations"."project_id" is null')
    expect(params).toEqual(expect.arrayContaining(['org_1', 'user_1', PROJECT_ID]))
  })

  it('a project the caller may not see deletes nothing', async () => {
    requireProjectAccessMock.mockRejectedValueOnce(new ForbiddenError())

    const res = await del(`?place=project&projectId=${PROJECT_ID}`)

    expect(res.status).toBe(403)
    expect(captured).toHaveLength(0)
    expect(enqueueJobMock).not.toHaveBeenCalled()
  })

  it('answers what it deleted and what a hold kept, and erases on a job, not in the request', async () => {
    candidates.rows = [
      ['s_a', 'Garagengesetz', false],
      ['s_held', 'Gehalten', true],
    ]

    const res = await del('?place=personal')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: ['s_a'], held: [{ id: 's_held', title: 'Gehalten' }] })
    const update = captured.find((entry) => entry.sql.startsWith('update'))
    expect(update?.sql).toContain('"created_by" = $')
    expect(update?.params).toContain('s_a')
    expect(update?.params).not.toContain('s_held')
    expect(enqueueJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'erase_conversations',
        organizationId: 'org_1',
        payload: expect.objectContaining({ requester: expect.objectContaining({ userId: 'user_1' }) }),
      })
    )
  })

  it('starts no job when there is nothing to delete', async () => {
    const res = await del('?place=personal')

    expect(await res.json()).toEqual({ deleted: [], held: [] })
    expect(enqueueJobMock).not.toHaveBeenCalled()
  })
})
