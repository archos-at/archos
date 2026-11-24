/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('@/lib/base-knowledge/context/corpus-countries', () => ({ corpusCountriesFor: vi.fn(async () => ['AT']) }))
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/conversations/repository', () => ({ findConversationTenancy: vi.fn(async () => null) }))

vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn(),
}))

vi.mock('@/lib/retrieval-scope/collection-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/retrieval-scope/collection-scope')>()
  return {
    ...actual,
    computeCollectionScope: vi.fn((_session, ctx) => {
      const scope: string[] = ['oib_knowledge']
      if (ctx.projectId) scope.push(`proj_${ctx.projectId}`)
      if (ctx.conversationId) scope.push(actual.sessionCollectionName(ctx.conversationId))
      return scope
    }),
    buildCollectionScopeHeader: vi.fn(actual.buildCollectionScopeHeader),
  }
})

import { getDb } from '@/lib/db'
import { requireProjectAccess } from '@/lib/authz/projects'

const mockGetDb = vi.mocked(getDb)
const mockRequireProjectAccess = vi.mocked(requireProjectAccess)

const baseSession: AuthorizedSession = {
  userId: 'user_1',
  email: 'a@b.com',
  name: null,
  accessToken: 'tok',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'member',
  permissions: [],
  featureFlags: null,
}

function mockDbSelect(rows: Array<{ prefs: Record<string, unknown> }>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(rows)),
        })),
      })),
    })),
  }
}

describe('buildCollectionScopeFromRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDb.mockReturnValue(mockDbSelect([]) as never)
  })

  it('builds base-only scope for anonymous mode', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'false')
    const { scope } = await buildCollectionScopeFromRequest(null, {})
    expect(scope).toEqual(['oib_knowledge'])
    expect(mockRequireProjectAccess).not.toHaveBeenCalled()
    vi.stubEnv('REQUIRE_AUTH', undefined)
  })

  it('authorizes project and includes proj_ corpus', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'true')
    mockRequireProjectAccess.mockResolvedValue({ role: 'project-viewer', closed: false, readsBecauseClosed: false })
    const { scope } = await buildCollectionScopeFromRequest(baseSession, {
      projectId: 'proj_1',
      conversationId: 'conv_1',
    })
    expect(scope).toEqual(['oib_knowledge', 'proj_proj_1', 's_conv_1'])
    expect(mockRequireProjectAccess).toHaveBeenCalledWith(baseSession, 'proj_1', [
      'project:chat',
      'project:edit',
    ])
    vi.stubEnv('REQUIRE_AUTH', undefined)
  })

  it('reads no project when the request names none, whatever the stored preferences say', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'true')
    mockGetDb.mockReturnValue(mockDbSelect([{ prefs: { active_project_id: 'pref_1' } }]) as never)
    const { scope, projectId } = await buildCollectionScopeFromRequest(baseSession, {})
    expect(scope).toEqual(['oib_knowledge'])
    expect(projectId).toBeUndefined()
    expect(mockRequireProjectAccess).not.toHaveBeenCalled()
    vi.stubEnv('REQUIRE_AUTH', undefined)
  })
})
