/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireResourceAccessMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: requireResourceAccessMock }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

import { ForbiddenError } from '@/lib/api/errors'
import { fetchDraftFromBackend } from './draft-backend'
import { deleteConversationDraft } from './draft-edits'

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

describe('a draft path', () => {
  it.each(['/drafts/../x.xlsx', '/drafts//x.xlsx', '/drafts/./x.xlsx', '/drafts/x/..'])('refuses %s', async (path) => {
    await expect(fetchDraftFromBackend('conv-1', path, { raw: true })).rejects.toMatchObject({ status: 400 })
    await expect(deleteConversationDraft(session, 'conv-1', path)).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
