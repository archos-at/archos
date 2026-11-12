/**
 * @vitest-environment node
 */
/**
 * PATCH /api/conversations/[id] with `temporary` (ADR-0180 rule 2): the switch
 * a person sets so that nothing from the conversation is kept in memory. The
 * service's own gate is `temporary.spec.ts`; here, the route's dispatch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    role: 'member',
    permissions: [],
  }),
}))
vi.mock('@/lib/conversations/service', () => ({
  deleteConversation: vi.fn(),
  getConversation: vi.fn(),
  updateConversationEngagement: vi.fn(),
  updateConversationTitle: vi.fn(),
}))
vi.mock('@/lib/conversations/temporary', () => ({ setConversationTemporary: vi.fn() }))

import { ForbiddenError } from '@/lib/api/errors'
import { updateConversationEngagement, updateConversationTitle } from '@/lib/conversations/service'
import { setConversationTemporary } from '@/lib/conversations/temporary'
import { PATCH } from './route'

const SESSION = expect.objectContaining({ userId: 'user_1', organizationId: 'org_1' })

function patch(body: unknown) {
  return PATCH(
    new Request('https://grid.test/api/conversations/s_1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 's_1' }) }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(setConversationTemporary).mockImplementation(async (_session, id, temporary) => ({ id, temporary }) as never)
})

describe('PATCH /api/conversations/[id] — temporary', () => {
  it.each([true, false])('switches the flag to %s and answers the conversation', async (temporary) => {
    const response = await patch({ temporary })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 's_1', temporary })
    expect(setConversationTemporary).toHaveBeenCalledWith(SESSION, 's_1', temporary)
    expect(updateConversationTitle).not.toHaveBeenCalled()
    expect(updateConversationEngagement).not.toHaveBeenCalled()
  })

  it('applies the flag and then the rename when a body carries both, answering the renamed row', async () => {
    vi.mocked(updateConversationTitle).mockResolvedValue({ id: 's_1', title: 'Fire safety', temporary: true } as never)

    const response = await patch({ temporary: true, title: 'Fire safety' })

    expect(await response.json()).toEqual({ id: 's_1', title: 'Fire safety', temporary: true })
    expect(setConversationTemporary).toHaveBeenCalledWith(SESSION, 's_1', true)
    expect(updateConversationTitle).toHaveBeenCalledWith(SESSION, 's_1', 'Fire safety')
  })

  it('applies the flag and then the engagement mode when a body carries both', async () => {
    vi.mocked(updateConversationEngagement).mockResolvedValue({ id: 's_1', engagementMode: 'mention' } as never)

    await patch({ temporary: false, engagement: 'mention' })

    expect(setConversationTemporary).toHaveBeenCalledWith(SESSION, 's_1', false)
    expect(updateConversationEngagement).toHaveBeenCalledWith(SESSION, 's_1', 'mention')
  })

  it('changes nothing else when the caller may not switch the flag', async () => {
    vi.mocked(setConversationTemporary).mockRejectedValue(new ForbiddenError())

    const response = await patch({ temporary: true, title: 'Fire safety' })

    expect(response.status).toBe(403)
    expect(updateConversationTitle).not.toHaveBeenCalled()
  })

  it('leaves a rename alone: a body without the field never touches the flag', async () => {
    vi.mocked(updateConversationTitle).mockResolvedValue({ id: 's_1', title: 'Fire safety' } as never)

    await patch({ title: 'Fire safety' })

    expect(setConversationTemporary).not.toHaveBeenCalled()
  })

  it('refuses a flag that is not a boolean, and still refuses an empty body', async () => {
    expect((await patch({ temporary: 'yes' })).status).toBe(400)
    expect((await patch({})).status).toBe(400)
    expect(setConversationTemporary).not.toHaveBeenCalled()
  })
})
