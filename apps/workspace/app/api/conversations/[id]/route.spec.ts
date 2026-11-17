/**
 * @vitest-environment node
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

vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/conversations/restricted-use', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/restricted-use')>()),
  peopleWhoMayRead: vi.fn(async (_org: string, _id: string, userIds: readonly string[]) => new Set(userIds)),
  lockedConversationIds: vi.fn(async () => new Set<string>()),
}))
vi.mock('@/lib/conversations/cross-project-use', () => ({ restrictingOtherProjects: vi.fn(async () => []) }))
vi.mock('@/lib/compliance/repository', () => ({
  isCoveredByActiveHold: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/sharing/repository', () => ({
  findGrantForSubject: vi.fn(),
  countGrantsForResource: vi.fn(),
  deleteAllGrantsForResource: vi.fn(),
}))
vi.mock('@/lib/mentions/repository', () => ({ deleteRequestsForResource: vi.fn() }))
vi.mock('@/lib/session-documents/repository', () => ({
  listSessionDocumentsForCleanup: vi.fn().mockResolvedValue([]),
  deleteSessionDocumentsByIds: vi.fn().mockResolvedValue(undefined),
  SESSION_DOCUMENT_LIST_LIMIT: 100,
}))
vi.mock('@/lib/session-documents/cleanup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session-documents/cleanup')>()),
  deleteSessionCollection: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/inbox/repository', () => ({ deleteItemsForResource: vi.fn() }))
vi.mock('@/lib/conversations/repository', () => ({
  deleteConversationInOrg: vi.fn(),
  findConversationInOrg: vi.fn(),
  findConversationRead: vi.fn(),
  findConversationTenancy: vi.fn(),
  findMessageInConversation: vi.fn(),
  insertConversation: vi.fn(),
  insertMessages: vi.fn(),
  listMessagesForConversation: vi.fn(),
  listVisibleConversations: vi.fn(),
  markConversationDeleting: vi.fn().mockResolvedValue({ id: 'conv_1' }),
  recordConversationErased: vi.fn().mockResolvedValue(1),
  mergeMessageMetadata: vi.fn(),
  updateConversationMetaInOrg: vi.fn(),
  updateConversationTitleInOrg: vi.fn(),
  upsertConversationRead: vi.fn(),
}))

import { requireProjectAccess } from '@/lib/authz/projects'
import { restrictingOtherProjects } from '@/lib/conversations/cross-project-use'
import {
  deleteConversationInOrg,
  findConversationInOrg,
  findConversationRead,
  findConversationTenancy,
} from '@/lib/conversations/repository'
import { countGrantsForResource, deleteAllGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { deleteRequestsForResource } from '@/lib/mentions/repository'
import { deleteItemsForResource } from '@/lib/inbox/repository'
import { DELETE, GET } from './route'

const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const del = () =>
  DELETE(new Request('https://grid.example/api/conversations/conv_1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'conv_1' }),
  })

describe('DELETE /api/conversations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor' } as never)
    vi.mocked(findGrantForSubject).mockResolvedValue(null)
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'project',
      createdBy: 'user_1',
      deletedAt: null,
    })
    vi.mocked(deleteAllGrantsForResource).mockResolvedValue(0)
    vi.mocked(deleteRequestsForResource).mockResolvedValue(0)
    vi.mocked(deleteItemsForResource).mockResolvedValue(0)
  })

  it('deletes an owned conversation, scoped to the caller organization', async () => {
    const res = await del()

    expect(res.status).toBe(204)
    expect(deleteConversationInOrg).toHaveBeenCalledWith('conv_1', 'org_1')
  })

  it('purges the collaboration rows no foreign key can cascade into', async () => {
    await del()

    expect(deleteAllGrantsForResource).toHaveBeenCalledWith('conversation', 'conv_1')
    expect(deleteRequestsForResource).toHaveBeenCalledWith('conversation', 'conv_1')
    expect(deleteItemsForResource).toHaveBeenCalledWith('conversation', 'conv_1')
  })

  it('never deletes a conversation the caller does not own', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'project',
      createdBy: 'user_2',
      deletedAt: null,
    })

    const res = await del()

    expect(res.status).toBe(204)
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
    expect(deleteAllGrantsForResource).not.toHaveBeenCalled()
    expect(deleteRequestsForResource).not.toHaveBeenCalled()
    expect(deleteItemsForResource).not.toHaveBeenCalled()
  })

  it('never deletes another organization conversation, and never asks about its project', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_2',
      projectId: PROJECT_ID,
      visibility: 'project',
      createdBy: 'user_1',
      deletedAt: null,
    })

    expect((await del()).status).toBe(204)
    expect(requireProjectAccess).not.toHaveBeenCalled()
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })

  it('stays a no-op for an id that never reached the server', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue(null)

    expect((await del()).status).toBe(204)
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })

  it("answers BYTE-IDENTICALLY for an absent id and for one that is not the caller's (spec SH-6)", async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue(null)
    const absent = await del()

    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'private',
      createdBy: 'user_2',
      deletedAt: null,
    })
    const forbidden = await del()

    expect(forbidden.status).toBe(absent.status)
    expect(await forbidden.text()).toBe(await absent.text())
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })
})

describe('GET /api/conversations/[id]: the other projects that restrict the chat (ADR-0094)', () => {
  const GRAZ = { id: '22222222-0000-4000-8000-000000000002', name: 'Wohnbau Graz' }
  const get = () =>
    GET(new Request('https://grid.example/api/conversations/conv_1'), { params: Promise.resolve({ id: 'conv_1' }) })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor' } as never)
    vi.mocked(findGrantForSubject).mockResolvedValue(null)
    vi.mocked(countGrantsForResource).mockResolvedValue(0)
    vi.mocked(findConversationRead).mockResolvedValue(null)
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'private',
      createdBy: 'user_1',
      deletedAt: null,
    })
    vi.mocked(findConversationInOrg).mockResolvedValue({ id: 'conv_1', organizationId: 'org_1', engagement: null } as never)
    vi.mocked(restrictingOtherProjects).mockResolvedValue([])
  })

  it('answers the current restricting projects, asked of this conversation in the caller organization', async () => {
    vi.mocked(restrictingOtherProjects).mockResolvedValue([GRAZ, { id: 'gone', name: null }])

    const res = await get()

    expect(res.status).toBe(200)
    expect((await res.json()).restrictingOtherProjects).toEqual([GRAZ, { id: 'gone', name: null }])
    expect(restrictingOtherProjects).toHaveBeenCalledWith('conv_1', 'org_1')
  })

  it('answers 404 and reads no record for a private conversation of somebody else', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'private',
      createdBy: 'user_2',
      deletedAt: null,
    })

    const res = await get()

    expect(res.status).toBe(404)
    expect(restrictingOtherProjects).not.toHaveBeenCalled()
  })
})
