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

vi.mock('@/lib/retrieval-scope/collection-scope-request', () => ({
  buildCollectionScopeFromRequest: vi.fn(),
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
import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
import { loadProjectPromptView } from '@/lib/project-profile/prompt-view'

const mockGetUserSession = vi.mocked(getUserSession)
const mockRequireProjectAccess = vi.mocked(requireProjectAccess)
const mockBuildCollectionScopeFromRequest = vi.mocked(buildCollectionScopeFromRequest)
const mockLoadProjectPromptView = vi.mocked(loadProjectPromptView)

describe('/api/auth/websocket-scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('REQUIRE_AUTH', undefined)
    mockLoadProjectPromptView.mockResolvedValue(null)
  })

  it('returns scope and header when auth is disabled', async () => {
    vi.stubEnv('REQUIRE_AUTH', 'false')
    mockGetUserSession.mockResolvedValue(null)
    mockBuildCollectionScopeFromRequest.mockResolvedValue({
      scope: ['oib_knowledge'],
      scopedCollections: [{ collection: 'oib_knowledge', shelf: 'base' }],
      headerValue: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      projectCollectionName: undefined,
      verifiedConversationId: undefined,
    })

    const req = new Request(
      'http://localhost:3000/api/auth/websocket-scope?projectId=proj-1&conversationId=conv-1'
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      scope: ['oib_knowledge'],
      scopedCollections: [{ collection: 'oib_knowledge', shelf: 'base' }],
      header: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      memoryReflectionEnabled: true,
    })
    expect(mockRequireProjectAccess).not.toHaveBeenCalled()
    expect(mockBuildCollectionScopeFromRequest).toHaveBeenCalledWith(null, {
      projectId: 'proj-1',
      conversationId: 'conv-1',
      interactiveChat: true,
    })
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
    mockBuildCollectionScopeFromRequest.mockResolvedValue({
      scope: ['oib_knowledge', 'proj_proj-1'],
      scopedCollections: [{ collection: 'oib_knowledge', shelf: 'base' }, { collection: 'proj_proj-1', shelf: 'project' }],
      headerValue: 'scope-header',
      projectId: 'proj-1',
      conversationId: undefined,
      projectCollectionName: undefined,
      verifiedConversationId: undefined,
    })

    const req = new Request('http://localhost:3000/api/auth/websocket-scope?projectId=proj-1')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockBuildCollectionScopeFromRequest).toHaveBeenCalledWith(session, {
      projectId: 'proj-1',
      conversationId: undefined,
      interactiveChat: true,
    })
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
    mockBuildCollectionScopeFromRequest.mockRejectedValue(new NotFoundError())

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
