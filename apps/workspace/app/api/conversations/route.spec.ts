/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { NotFoundError } from '@/lib/api/errors'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    role: 'member',
    permissions: [],
  }),
}))

const requireProjectAccessMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: requireProjectAccessMock,
}))

const captured = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>)
vi.mock('@/lib/db', () => {
  const db = drizzle(async (sql, params) => {
    captured.push({ sql, params })
    return { rows: [] }
  })
  return { getDb: () => db }
})

import { GET } from './route'

const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function onlyQuery(): { sql: string; params: unknown[] } {
  expect(captured).toHaveLength(1)
  return captured[0]
}

describe('GET /api/conversations', () => {
  beforeEach(() => {
    captured.length = 0
    requireProjectAccessMock.mockReset()
    requireProjectAccessMock.mockResolvedValue({ role: 'project-editor' })
  })

  it('narrows an unscoped list to the caller — own, granted, or org-visible', async () => {
    const res = await GET(new Request('https://grid.example/api/conversations'))

    expect(res.status).toBe(200)
    expect(requireProjectAccessMock).not.toHaveBeenCalled()

    const { sql, params } = onlyQuery()
    expect(sql).toContain('"conversations"."organization_id" = $1')
    expect(sql).toContain('"conversations"."created_by" = $2')
    expect(sql).toContain('exists (select 1 from "resource_shares"')
    expect(params).toContain('organization')
    expect(params).toContain('user_1')
  })

  it('scopes by projectId, keeping tenancy, unstamped rows, and privacy', async () => {
    const res = await GET(
      new Request(`https://grid.example/api/conversations?projectId=${PROJECT_ID}`)
    )

    expect(res.status).toBe(200)
    const { sql, params } = onlyQuery()
    expect(sql).toContain('"conversations"."organization_id" = $1')
    expect(sql).toContain('("conversations"."project_id" = $2 and (')
    expect(sql).toContain('or ("conversations"."project_id" is null and (')
    expect(sql).toContain('"conversations"."visibility" <> $3')
    expect(sql).toContain('exists (select 1 from "resource_shares"')
    expect(params).toContain('private')
  })

  it('requires project access for a projectId filter (cross-org probing -> 404)', async () => {
    requireProjectAccessMock.mockRejectedValue(new NotFoundError())

    const res = await GET(
      new Request(`https://grid.example/api/conversations?projectId=${PROJECT_ID}`)
    )

    expect(requireProjectAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_1', userId: 'user_1' }),
      PROJECT_ID,
      'project:view'
    )
    expect(res.status).toBe(404)
    expect(captured).toHaveLength(0)
  })

  it('rejects a malformed projectId with 400', async () => {
    const res = await GET(
      new Request('https://grid.example/api/conversations?projectId=not-a-uuid')
    )

    expect(res.status).toBe(400)
    expect(requireProjectAccessMock).not.toHaveBeenCalled()
    expect(captured).toHaveLength(0)
  })
})
