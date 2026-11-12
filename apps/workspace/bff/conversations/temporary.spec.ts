/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./temporary-repository', () => ({
  readConversationTemporary: vi.fn(),
  updateConversationTemporaryInOrg: vi.fn(),
}))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn() }))

import { ForbiddenError, NotFoundError, TemporaryConversationError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'
import { isTemporaryConversation, requireConversationKeepsMemory, setConversationTemporary } from './temporary'
import { readConversationTemporary, updateConversationTemporaryInOrg } from './temporary-repository'

const session = { userId: 'user_1', organizationId: 'org_1', role: 'member', permissions: [] } as unknown as AuthorizedSession

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readConversationTemporary).mockResolvedValue(false)
})

describe('requireConversationKeepsMemory', () => {
  it('refuses a temporary conversation with 403 TEMPORARY_CONVERSATION, in English', async () => {
    vi.mocked(readConversationTemporary).mockResolvedValue(true)

    const refused = requireConversationKeepsMemory('s_1', 'org_1')

    await expect(refused).rejects.toBeInstanceOf(TemporaryConversationError)
    await expect(refused).rejects.toMatchObject({
      status: 403,
      code: 'TEMPORARY_CONVERSATION',
      message: 'This conversation is temporary: nothing from it is kept in memory',
    })
    expect(readConversationTemporary).toHaveBeenCalledWith('s_1', 'org_1')
  })

  it('lets a conversation that keeps memory through, and one whose row does not exist yet', async () => {
    // The repository answers false for a row that is not there (and for another organization's).
    await expect(requireConversationKeepsMemory('s_not_created_yet', 'org_1')).resolves.toBeUndefined()
  })

  it.each([
    ['no conversation', undefined, 'org_1'],
    ['a null conversation', null, 'org_1'],
    ['no organization', 's_1', null],
  ])('asks nothing and refuses nothing with %s: not a write a chat turn made', async (_name, conversationId, organizationId) => {
    await expect(requireConversationKeepsMemory(conversationId, organizationId)).resolves.toBeUndefined()
    expect(await isTemporaryConversation(conversationId, organizationId)).toBe(false)
    expect(readConversationTemporary).not.toHaveBeenCalled()
  })
})

describe('setConversationTemporary', () => {
  it('is an owner’s switch, scoped to the caller’s organization, on and off', async () => {
    vi.mocked(updateConversationTemporaryInOrg).mockImplementation(
      async (id, organizationId, temporary) => ({ id, organizationId, temporary }) as never
    )

    expect(await setConversationTemporary(session, 's_1', true)).toMatchObject({ id: 's_1', temporary: true })
    expect(await setConversationTemporary(session, 's_1', false)).toMatchObject({ temporary: false })

    expect(requireResourceAccess).toHaveBeenCalledWith(session, 'conversation', 's_1', 'owner')
    expect(updateConversationTemporaryInOrg).toHaveBeenNthCalledWith(1, 's_1', 'org_1', true)
    expect(updateConversationTemporaryInOrg).toHaveBeenNthCalledWith(2, 's_1', 'org_1', false)
  })

  it('writes nothing for a caller who is not an owner', async () => {
    vi.mocked(requireResourceAccess).mockRejectedValue(new ForbiddenError())

    await expect(setConversationTemporary(session, 's_1', true)).rejects.toBeInstanceOf(ForbiddenError)
    expect(updateConversationTemporaryInOrg).not.toHaveBeenCalled()
  })

  it('is a 404 when the row is not in this organization', async () => {
    vi.mocked(updateConversationTemporaryInOrg).mockResolvedValue(null)

    await expect(setConversationTemporary(session, 's_1', true)).rejects.toBeInstanceOf(NotFoundError)
  })
})
