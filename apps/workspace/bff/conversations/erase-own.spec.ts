/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/conversations/repository', () => ({
  deleteConversationInOrg: vi.fn(),
  findConversationTenancy: vi.fn(),
  markConversationDeleting: vi.fn(),
  recordConversationErased: vi.fn(),
}))
vi.mock('@/lib/conversations/own-conversations-repository', () => ({
  listMarkedOwnConversationIds: vi.fn(),
  markOwnConversationsDeleting: vi.fn(),
}))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn() }))
vi.mock('@/lib/session-documents/cleanup', () => ({
  purgeSessionDocuments: vi.fn(),
  deleteSessionCollection: vi.fn(),
}))
vi.mock('@/lib/compliance/holds', () => ({ assertNoActiveHold: vi.fn() }))
vi.mock('@/lib/collaboration/cleanup', () => ({ purgeConversationCollaboration: vi.fn() }))
vi.mock('./working-directory', () => ({ discardConversationDrafts: vi.fn() }))
vi.mock('@/lib/jobs-queue/enqueue', () => ({ enqueueJob: vi.fn() }))
vi.mock('@/lib/db/tenant-context', () => ({
  withTenant: vi.fn((_scope: unknown, run: () => unknown) => run()),
}))

import { ConflictError } from '@/lib/api/errors'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { emptyCounts, requesterOf, type EraseConversationsPayload } from '@/lib/jobs-queue/types'
import { deleteSessionCollection, purgeSessionDocuments } from '@/lib/session-documents/cleanup'
import { deleteOwnConversations, ERASE_SLICE_CONVERSATIONS, runEraseConversationsSlice } from './conversation-erasure'
import { deleteConversationInOrg } from './repository'
import { listMarkedOwnConversationIds, markOwnConversationsDeleting } from './own-conversations-repository'
import { session } from './service.fixtures'

const MARKED_AT = new Date('2026-11-24T17:57:40.442Z')

const payload = (over: Partial<EraseConversationsPayload> = {}): EraseConversationsPayload => ({
  markedAt: MARKED_AT.toISOString(),
  requester: requesterOf(session),
  cursor: null,
  counts: emptyCounts(),
  ...over,
})

beforeEach(() => {
  vi.mocked(purgeSessionDocuments).mockResolvedValue({ ok: true, retained: 0, failures: [] } as never)
  vi.mocked(deleteSessionCollection).mockResolvedValue({ ok: true } as never)
  vi.mocked(assertNoActiveHold).mockResolvedValue(undefined)
  vi.mocked(deleteConversationInOrg).mockReset()
  vi.mocked(enqueueJob).mockReset()
})

describe('deleteOwnConversations', () => {
  it('hands the marked chats to one erase job and answers what a hold kept', async () => {
    vi.mocked(markOwnConversationsDeleting).mockResolvedValueOnce({
      markedAt: MARKED_AT,
      marked: [{ id: 's_1', title: 'Garagengesetz' }],
      held: [{ id: 's_held', title: 'Gehalten' }],
    })

    const result = await deleteOwnConversations(session, { projectId: null })

    expect(result).toEqual({ deleted: ['s_1'], held: [{ id: 's_held', title: 'Gehalten' }] })
    expect(markOwnConversationsDeleting).toHaveBeenCalledWith(session.organizationId, session.userId, { projectId: null })
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({
      kind: 'erase_conversations',
      organizationId: session.organizationId,
      payload: { markedAt: MARKED_AT.toISOString(), cursor: null },
    })
  })
})

describe('runEraseConversationsSlice', () => {
  it('erases the slice it reads, and asks for the next one after the last id', async () => {
    const ids = Array.from({ length: ERASE_SLICE_CONVERSATIONS }, (_, i) => `s_${String(i).padStart(2, '0')}`)
    vi.mocked(listMarkedOwnConversationIds).mockResolvedValueOnce(ids)

    const result = await runEraseConversationsSlice(session, payload())

    expect(listMarkedOwnConversationIds).toHaveBeenCalledWith(session.organizationId, session.userId, MARKED_AT, {
      after: null,
      limit: ERASE_SLICE_CONVERSATIONS,
    })
    expect(deleteConversationInOrg).toHaveBeenCalledTimes(ERASE_SLICE_CONVERSATIONS)
    expect(result.done).toBe(false)
    expect(result.payload.cursor).toBe(ids.at(-1))
    expect(result.payload.counts.queued).toBe(ERASE_SLICE_CONVERSATIONS)
  })

  it('ends on a short slice', async () => {
    vi.mocked(listMarkedOwnConversationIds).mockResolvedValueOnce(['s_last'])

    const result = await runEraseConversationsSlice(session, payload({ cursor: 's_09' }))

    expect(result.done).toBe(true)
    expect(result.payload.cursor).toBe('s_last')
  })

  it('counts a chat whose erase fails and goes on with the rest; the deletion queue retries it', async () => {
    vi.mocked(listMarkedOwnConversationIds).mockResolvedValueOnce(['s_held_since', 's_ok'])
    vi.mocked(assertNoActiveHold).mockRejectedValueOnce(new ConflictError('held'))

    const result = await runEraseConversationsSlice(session, payload())

    expect(deleteConversationInOrg).toHaveBeenCalledTimes(1)
    expect(deleteConversationInOrg).toHaveBeenCalledWith('s_ok', session.organizationId)
    expect(result.payload.counts).toMatchObject({ queued: 1, failed: 1, failedNames: ['s_held_since'] })
    expect(result.done).toBe(true)
  })
})
