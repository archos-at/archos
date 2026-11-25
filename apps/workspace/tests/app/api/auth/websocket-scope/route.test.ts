/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError } from '@/lib/api/errors'

vi.mock('@/lib/auth/session', () => ({
  getUserSession: vi.fn(),
}))

vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn(),
}))

vi.mock('@/lib/conversation-context', () => ({
  resolveConversationScope: vi.fn(),
}))

vi.mock('@/lib/project-profile/prompt-view', () => ({
  loadProjectPromptView: vi.fn(),
  loadProjectFederalState: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/projects/memory-service', () => ({
  buildProjectMemoryDigest: vi.fn(),
}))

import { GET } from '@/app/api/auth/websocket-scope/route'
import { getUserSession } from '@/lib/auth/session'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveConversationScope } from '@/lib/conversation-context'
import { scopeWith } from '@/lib/conversation-context/context.fixtures'
import type { ScopedCollection } from '@/lib/retrieval-scope/collection-scope'
import { loadProjectPromptView } from '@/lib/project-profile/prompt-view'

const mockGetUserSession = vi.mocked(getUserSession)
const mockRequireProjectAccess = vi.mocked(requireProjectAccess)
const mockResolveConversationContext = vi.mocked(resolveConversationScope)

function decided(shelves: ScopedCollection[], projectId: string | null) {
  return scopeWith(shelves, projectId)
}

const header = (shelves: ScopedCollection[]) => Buffer.from(JSON.stringify(shelves)).toString('base64url')
const mockLoadProjectPromptView = vi.mocked(loadProjectPromptView)

describe('/api/auth/websocket-scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('REQUIRE_AUTH', undefined)
    mockLoadProjectPromptView.mockResolvedValue(null)
  })

  it('returns the turn context without shelves when auth is disabled', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'false')
    mockGetUserSession.mockResolvedValue(null)
    mockResolveConversationContext.mockResolvedValue(decided([], 'proj-1'))

    const req = new Request(
      'http://localhost:3000/api/auth/websocket-scope?projectId=proj-1&conversationId=conv-1'
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      scope: [],
      scopedCollections: [],
      header: header([]),
      projectId: 'proj-1',
      conversationId: 'conv-1',
      memoryReflectionEnabled: true,
    })
    expect(mockRequireProjectAccess).not.toHaveBeenCalled()
    expect(mockResolveConversationContext).toHaveBeenCalledWith(
      null,
      { projectId: 'proj-1', conversationId: 'conv-1', kind: 'chat' },
      { withoutShelves: true },
    )
  })

  it('returns 401 when auth is required and there is no session', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'true')
    mockGetUserSession.mockResolvedValue(null)

    const req = new Request('http://localhost:3000/api/auth/websocket-scope')
    const res = await GET(req)

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual({ error: 'Unauthorized' })
  })

  it('authorizes project access when auth is required and projectId is provided', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'true')
    const session = {
      userId: 'user_1',
      email: 'a@b.com',
      name: null,
      accessToken: 'tok',
      organizationId: 'org_1',
      organizationMembershipId: 'om_1',
      role: 'member',
      permissions: [] as string[],
  featureFlags: null,
    }
    mockGetUserSession.mockResolvedValue(session)
    mockResolveConversationContext.mockResolvedValue(
      decided([{ collection: 'base_corpus', shelf: 'base' }, { collection: 'proj_proj-1', shelf: 'project' }], 'proj-1')
    )

    const req = new Request('http://localhost:3000/api/auth/websocket-scope?projectId=proj-1')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockResolveConversationContext).toHaveBeenCalledWith(
      session,
      { projectId: 'proj-1', conversationId: undefined, kind: 'chat' },
      { withoutShelves: true },
    )
    expect(mockRequireProjectAccess).not.toHaveBeenCalled()
  })

  it('returns 403 on authorization failure', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'true')
    const session = {
      userId: 'user_1',
      email: 'a@b.com',
      name: null,
      accessToken: 'tok',
      organizationId: 'org_1',
      organizationMembershipId: 'om_1',
      role: 'member',
      permissions: [] as string[],
  featureFlags: null,
    }
    mockGetUserSession.mockResolvedValue(session)
    mockResolveConversationContext.mockRejectedValue(new NotFoundError())

    const req = new Request('http://localhost:3000/api/auth/websocket-scope?projectId=proj-1')
    const res = await GET(req)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json).toEqual({ error: 'Forbidden' })
  })

  it('returns 500 for unexpected errors', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'false')
    mockGetUserSession.mockRejectedValue(new Error('database unavailable'))

    const req = new Request('http://localhost:3000/api/auth/websocket-scope')
    const res = await GET(req)

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toEqual({ error: 'Internal Server Error' })
  })
})
