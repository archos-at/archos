/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError } from '@/lib/api/errors'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn(),
}))

vi.mock('@/lib/conversation-context', () => ({
  resolveConversationScope: vi.fn(),
}))

vi.mock('@/lib/projects/repository', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/projects/repository')>()),
  findProjectTenancy: vi.fn(async () => null),
}))

import { GET, POST, DELETE } from '@/app/api/jobs/async/[...path]/route'
import { findProjectTenancy } from '@/lib/projects/repository'
import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import { resolveConversationScope } from '@/lib/conversation-context'
import type { ConversationScope } from '@/lib/conversation-context/resolve'
import { encodeCollectionScopeHeader, type ScopedCollection } from '@/lib/retrieval-scope/collection-scope'

const mockRequireAuthorizedSession = vi.mocked(requireAuthorizedSession)
const mockResolveConversationScope = vi.mocked(resolveConversationScope)

interface BuiltScope {
  scopedCollections: ScopedCollection[]
  projectId?: string
  verifiedConversationId?: string
  projectReadOnly?: boolean
  [key: string]: unknown
}

let decidedShelves: ScopedCollection[] = []

function asScope(built: BuiltScope): ConversationScope {
  decidedShelves = built.scopedCollections
  return {
    kind: 'run',
    conversationId: null,
    audience: { row: { exists: false, projectId: null, createdBy: null, visibility: 'private', grantees: [], version: null }, solo: false, version: null },
    projectId: built.projectId ?? null,
    projectCollectionName: null,
    shelves: built.scopedCollections,
    restrictedCollections: [],
    verifiedConversationId: built.verifiedConversationId ?? null,
    projectReadOnly: built.projectReadOnly ?? false,
  }
}

const decidedHeader = (): string => encodeCollectionScopeHeader(decidedShelves)


const baseSession = {
  userId: 'user_1',
  email: 'a@b.com',
  name: null,
  accessToken: 'tok',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'member',
  permissions: [] as string[],
  featureFlags: ['deep-research'],
}

function createStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: hello\n\n'))
      controller.close()
    },
  })
}

function makeParams(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) }
}

function getHeader(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>
  return headers[name]
}

describe('/api/jobs/async/[...path]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('REQUIRE_AUTH', undefined)
  })

  describe('GET', () => {
    it('forwards scope header for stream requests', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')
      mockRequireAuthorizedSession.mockResolvedValue(baseSession)
      mockResolveConversationScope.mockResolvedValue(asScope({
        scope: ['oib_knowledge', 'proj_proj-1', 's_conv-1'],
        scopedCollections: [{ collection: 'oib_knowledge', shelf: 'base' }, { collection: 'proj_proj-1', shelf: 'project' }, { collection: 's_conv-1', shelf: 'session' }],
        headerValue: 'encoded-scope',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        projectCollectionName: undefined,
        verifiedConversationId: undefined,
        restrictedCollections: [],
      }))
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(createStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
      global.fetch = fetchMock

      const req = new Request(
        'http://localhost:3000/api/jobs/async/job/job-1/stream?projectId=proj-1&conversationId=conv-1'
      )
      const res = await GET(req, makeParams(['job', 'job-1', 'stream']))

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(getHeader(init, 'X-Collection-Scope')).toBe(decidedHeader())
      expect(getHeader(init, 'Accept')).toBe('text/event-stream')
      expect(mockResolveConversationScope).toHaveBeenCalledWith(baseSession, {
        projectId: 'proj-1',
        conversationId: 'conv-1',
        kind: 'run',
      })
    })

    it('uses anonymous session when auth is disabled', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'false')
      mockResolveConversationScope.mockResolvedValue(asScope({
        scope: ['oib_knowledge', 's_conv-1'],
        scopedCollections: [{ collection: 'oib_knowledge', shelf: 'base' }, { collection: 's_conv-1', shelf: 'session' }],
        headerValue: 'anon-scope',
        projectId: undefined,
        conversationId: 'conv-1',
        projectCollectionName: undefined,
        verifiedConversationId: undefined,
        restrictedCollections: [],
      }))
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      global.fetch = fetchMock

      const req = new Request(
        'http://localhost:3000/api/jobs/async/agents?conversationId=conv-1'
      )
      const res = await GET(req, makeParams(['agents']))

      expect(res.status).toBe(200)
      expect(mockRequireAuthorizedSession).not.toHaveBeenCalled()
      expect(getHeader(fetchMock.mock.calls[0][1], 'X-Collection-Scope')).toBe(decidedHeader())
    })

    it('refuses to submit research in a closed project, and forwards nothing (ADR-0090)', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')
      mockRequireAuthorizedSession.mockResolvedValue(baseSession)
      mockResolveConversationScope.mockResolvedValue(asScope({
        scope: ['proj_proj-1'],
        scopedCollections: [{ collection: 'proj_proj-1', shelf: 'project' }],
        headerValue: 'encoded-scope',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        projectCollectionName: undefined,
        verifiedConversationId: undefined,
        restrictedCollections: [],
      }))
      vi.mocked(findProjectTenancy).mockResolvedValueOnce({ organizationId: 'org_1', deletedAt: null, status: 'closed' })
      const fetchMock = vi.fn()
      global.fetch = fetchMock

      const req = new Request('http://localhost:3000/api/jobs/async/submit', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'proj-1', conversationId: 'conv-1' }),
      })
      const res = await POST(req, makeParams(['submit']))

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toMatchObject({ error: { details: { reason: 'project-closed' } } })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns 404 when project access is missing', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')
      mockRequireAuthorizedSession.mockResolvedValue(baseSession)
      mockResolveConversationScope.mockRejectedValue(new NotFoundError())
      const fetchMock = vi.fn()
      global.fetch = fetchMock

      const req = new Request(
        'http://localhost:3000/api/jobs/async/agents?projectId=proj-1'
      )
      const res = await GET(req, makeParams(['agents']))

      expect(res.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('POST', () => {
    it('refuses a deep-research submit from a session whose organization lacks the flag', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')
      mockRequireAuthorizedSession.mockResolvedValue({ ...baseSession, featureFlags: [] })
      const fetchMock = vi.fn()
      global.fetch = fetchMock

      const req = new Request('http://localhost:3000/api/jobs/async/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-1', conversationId: 'conv-1' }),
      })
      const res = await POST(req, makeParams(['submit']))

      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'feature_disabled', feature: 'deep-research' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses an anonymous deep-research submit — an entitlement is off where nobody signs in', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'false')
      const fetchMock = vi.fn()
      global.fetch = fetchMock

      const req = new Request('http://localhost:3000/api/jobs/async/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-1' }),
      })
      const res = await POST(req, makeParams(['submit']))

      expect(res.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('forwards scope header from body', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')
      mockRequireAuthorizedSession.mockResolvedValue(baseSession)
      mockResolveConversationScope.mockResolvedValue(asScope({
        scope: ['oib_knowledge', 'proj_proj-1', 's_conv-1'],
        scopedCollections: [{ collection: 'oib_knowledge', shelf: 'base' }, { collection: 'proj_proj-1', shelf: 'project' }, { collection: 's_conv-1', shelf: 'session' }],
        headerValue: 'encoded-scope',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        projectCollectionName: undefined,
        verifiedConversationId: undefined,
        restrictedCollections: [],
      }))
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ job_id: 'job-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      global.fetch = fetchMock

      const req = new Request('http://localhost:3000/api/jobs/async/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-1', conversationId: 'conv-1' }),
      })
      const res = await POST(req, makeParams(['submit']))

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(getHeader(init, 'X-Collection-Scope')).toBe(decidedHeader())
      expect(mockResolveConversationScope).toHaveBeenCalledWith(baseSession, {
        projectId: 'proj-1',
        conversationId: 'conv-1',
        kind: 'run',
      })
    })

    it('returns 404 when project access is missing', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')
      mockRequireAuthorizedSession.mockResolvedValue(baseSession)
      mockResolveConversationScope.mockRejectedValue(new NotFoundError())
      const fetchMock = vi.fn()
      global.fetch = fetchMock

      const req = new Request('http://localhost:3000/api/jobs/async/submit', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'proj-1' }),
      })
      const res = await POST(req, makeParams(['submit']))

      expect(res.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('forwards scope header from query params', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')
      mockRequireAuthorizedSession.mockResolvedValue(baseSession)
      mockResolveConversationScope.mockResolvedValue(asScope({
        scope: ['oib_knowledge', 'proj_proj-1'],
        scopedCollections: [{ collection: 'oib_knowledge', shelf: 'base' }, { collection: 'proj_proj-1', shelf: 'project' }],
        headerValue: 'delete-scope',
        projectId: 'proj-1',
        conversationId: undefined,
        projectCollectionName: undefined,
        verifiedConversationId: undefined,
        restrictedCollections: [],
      }))
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'cancelled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      global.fetch = fetchMock

      const req = new Request(
        'http://localhost:3000/api/jobs/async/job/job-1/cancel?projectId=proj-1'
      )
      const res = await DELETE(req, makeParams(['job', 'job-1', 'cancel']))

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(init.method).toBe('DELETE')
      expect(getHeader(init, 'X-Collection-Scope')).toBe(decidedHeader())
      expect(mockResolveConversationScope).toHaveBeenCalledWith(baseSession, {
        projectId: 'proj-1',
        conversationId: undefined,
        kind: 'run',
      })
    })

    it('returns 404 when project access is missing', async () => {
      vi.stubEnv('REQUIRE_AUTH', 'true')
      mockRequireAuthorizedSession.mockResolvedValue(baseSession)
      mockResolveConversationScope.mockRejectedValue(new NotFoundError())
      const fetchMock = vi.fn()
      global.fetch = fetchMock

      const req = new Request(
        'http://localhost:3000/api/jobs/async/job/job-1/cancel?projectId=proj-1'
      )
      const res = await DELETE(req, makeParams(['job', 'job-1', 'cancel']))

      expect(res.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
