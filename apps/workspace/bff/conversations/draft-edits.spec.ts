/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireResourceAccessMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: requireResourceAccessMock }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

import { ForbiddenError } from '@/lib/api/errors'
import { fetchDraftFromBackend } from './draft-backend'
import { deleteConversationDraft, restoreConversationDraft } from './draft-edits'

const session = { userId: 'user_1', organizationId: 'org_1' } as never
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
  vi.stubGlobal('fetch', fetchMock)
  requireResourceAccessMock.mockResolvedValue({ role: 'collaborator' })
})

describe('deleting a draft', () => {
  it('asks the agent host to delete exactly that draft, as someone who may write in the conversation', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteConversationDraft(session, 'conv-1', '/drafts/Raumbuch alt.xlsx')).resolves.toEqual({
      path: '/drafts/Raumbuch alt.xlsx',
      deleted: true,
    })

    expect(requireResourceAccessMock).toHaveBeenCalledWith(session, 'conversation', 'conv-1', 'collaborator')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://backend:8000/v1/drafts/conv-1/drafts/Raumbuch%20alt.xlsx')
    expect(init.method).toBe('DELETE')
  })

  it('touches nothing for a reader who may only read the conversation', async () => {
    requireResourceAccessMock.mockRejectedValue(new ForbiddenError())
    await expect(deleteConversationDraft(session, 'conv-1', '/drafts/a.xlsx')).rejects.toBeInstanceOf(ForbiddenError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('restoring the earlier version', () => {
  it('answers the version the restore made', async () => {
    fetchMock.mockResolvedValue(Response.json({ path: '/drafts/a.xlsx', version: 4 }))

    await expect(restoreConversationDraft(session, 'conv-1', 'drafts/a.xlsx')).resolves.toEqual({
      path: '/drafts/a.xlsx',
      version: 4,
    })
    expect(fetchMock.mock.calls[0][0]).toBe('http://backend:8000/v1/drafts/conv-1/restore?path=%2Fdrafts%2Fa.xlsx')
  })
})

describe('reading one version of a draft', () => {
  it('asks for the version an old card names, and says when it is no longer kept', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 410 }))

    const gone = await fetchDraftFromBackend('conv-1', '/drafts/a.xlsx', { raw: true, version: 1 }).catch(
      (error: unknown) => error,
    )

    expect(fetchMock.mock.calls[0][0]).toBe('http://backend:8000/v1/drafts/conv-1/drafts/a.xlsx?raw=true&version=1')
    expect(gone).toMatchObject({ status: 410, details: { reason: 'version-gone' } })
  })
})
