/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))

vi.mock('@/lib/conversations/repository', () => ({
  deleteConversationInOrg: vi.fn(),
  findConversationInOrg: vi.fn(),
  findConversationRead: vi.fn(),
  findConversationTenancy: vi.fn(),
  findMessageInConversation: vi.fn(),
  insertConversation: vi.fn(),
  insertMessages: vi.fn(),
  listMessagePage: vi.fn(),
  listVisibleConversations: vi.fn(),
  markConversationDeleting: vi.fn(),
  recordConversationErased: vi.fn(),
  mergeMessageMetadata: vi.fn(),
  updateConversationMetaInOrg: vi.fn(),
  updateConversationTitleInOrg: vi.fn(),
  upsertConversationRead: vi.fn(),
}))

vi.mock('@/lib/sharing/repository', () => ({
  findGrantForSubject: vi.fn(),
  countGrantsForResource: vi.fn(),
}))

vi.mock('@/lib/sharing/service', () => ({ resolveParticipants: vi.fn() }))

vi.mock('./restricted-use', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./restricted-use')>()),
  peopleWhoMayRead: vi.fn(async (_organizationId: string, _conversationId: string, userIds: readonly string[]) => new Set(userIds)),
  lockedConversationIds: vi.fn(async () => new Set<string>()),
}))

vi.mock('./cross-project-use', () => ({ restrictingOtherProjects: vi.fn(async () => []) }))

vi.mock('@/lib/session-documents/cleanup', () => ({
  purgeSessionDocuments: vi.fn(),
  deleteSessionCollection: vi.fn(),
}))

vi.mock('@/lib/compliance/repository', () => ({
  isCoveredByActiveHold: vi.fn().mockResolvedValue(false),
}))

vi.mock('./working-directory', () => ({ discardConversationDrafts: vi.fn() }))

vi.mock('@/lib/collaboration/cleanup', () => ({ purgeConversationCollaboration: vi.fn() }))

vi.mock('@/lib/inbox/service', () => ({
  emitInboxItems: vi.fn(),
  markResourceItemsReadFor: vi.fn(),
}))

vi.mock('@/lib/mentions/service', () => ({
  applyMessageMentions: vi.fn(),
  resolveRequestsOnReply: vi.fn(),
  threadIsAwaitingHuman: vi.fn(),
}))

vi.mock('./engagement', () => ({
  resolveEngagement: vi.fn(),
  resolveEngagementFor: vi.fn(),
  setEngagement: vi.fn(),
}))

import { ConflictError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import { purgeConversationCollaboration } from '@/lib/collaboration/cleanup'
import { isCoveredByActiveHold } from '@/lib/compliance/repository'
import { threadIsAwaitingHuman } from '@/lib/mentions/service'
import type { Message } from '@/lib/db/schema/messages'
import { emitInboxItems } from '@/lib/inbox/service'
import { resolveRequestsOnReply } from '@/lib/mentions/service'
import { countGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { deleteSessionCollection, purgeSessionDocuments } from '@/lib/session-documents/cleanup'
import { discardConversationDrafts } from './working-directory'
import { resolveEngagement, resolveEngagementFor } from './engagement'
import { restrictingOtherProjects } from './cross-project-use'
import { lockedConversationIds, peopleWhoMayRead } from './restricted-use'
import { deleteConversationInOrg, findConversationRead, findConversationTenancy, findMessageInConversation, insertMessages, markConversationDeleting, recordConversationErased } from './repository'
import { deleteConversation, retryConversationErasure } from './service'
import { CONVERSATION_ID, session, stubConversation, stubContainer } from './service.fixtures'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(peopleWhoMayRead).mockImplementation(async (_org, _id, userIds) => new Set(userIds))
  vi.mocked(lockedConversationIds).mockResolvedValue(new Set())
  vi.mocked(restrictingOtherProjects).mockResolvedValue([])
  vi.stubEnv('REQUIRE_AUTH', 'true')
  stubConversation()
  stubContainer('project-editor')
  vi.mocked(findGrantForSubject).mockResolvedValue(null)
  vi.mocked(countGrantsForResource).mockResolvedValue(0)
  vi.mocked(threadIsAwaitingHuman).mockResolvedValue(false)
  vi.mocked(resolveEngagementFor).mockResolvedValue({ mode: 'ask', stored: null, suggestion: null })
  vi.mocked(resolveEngagement).mockResolvedValue({ mode: 'ask', stored: null, suggestion: null })
  vi.mocked(findConversationRead).mockResolvedValue(null)
  vi.mocked(resolveParticipants).mockResolvedValue([])
  vi.mocked(emitInboxItems).mockResolvedValue(0)
  vi.mocked(resolveRequestsOnReply).mockResolvedValue({
    answered: 0,
    askedBack: 0,
    askerUserIds: [],
  })
  vi.mocked(findMessageInConversation).mockResolvedValue(null)
  vi.mocked(insertMessages).mockImplementation(async (rows) => rows as Message[])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('discarding a chat that holds attachments', () => {
  beforeEach(() => {
    stubConversation({ createdBy: 'user_me' })
    vi.mocked(markConversationDeleting).mockResolvedValue({ id: CONVERSATION_ID } as never)
    vi.mocked(purgeSessionDocuments).mockResolvedValue({
      ok: true,
      purged: 0,
      retained: 0,
      failures: [],
    })
    vi.mocked(deleteSessionCollection).mockResolvedValue({ ok: true })
  })

  it('marks the conversation as deleting BEFORE it erases anything', async () => {
    const order: string[] = []
    vi.mocked(markConversationDeleting).mockImplementation(async () => {
      order.push('mark')
      return { id: CONVERSATION_ID } as never
    })
    vi.mocked(purgeSessionDocuments).mockImplementation(async () => {
      order.push('purge')
      return { ok: true, purged: 0, retained: 0, failures: [] }
    })
    vi.mocked(deleteSessionCollection).mockImplementation(async () => {
      order.push('collection')
      return { ok: true }
    })
    vi.mocked(deleteConversationInOrg).mockImplementation(async () => {
      order.push('delete')
    })

    await deleteConversation(session, CONVERSATION_ID)

    expect(order).toEqual(['mark', 'purge', 'collection', 'delete'])
  })

  it('erases the chat’s own s_ collection, which no attachment row names', async () => {
    await deleteConversation(session, CONVERSATION_ID)

    expect(deleteSessionCollection).toHaveBeenCalledWith(`s_${CONVERSATION_ID}`)
    expect(deleteConversationInOrg).toHaveBeenCalled()
  })

  it('KEEPS the conversation when its collection could not be erased', async () => {
    vi.mocked(deleteSessionCollection).mockResolvedValue({ ok: false, reason: 'answered 500' })

    await expect(deleteConversation(session, CONVERSATION_ID)).rejects.toThrow(/attachments failed/)

    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })

  it('refuses a held chat with a 409 before it is even marked deleting', async () => {
    vi.mocked(isCoveredByActiveHold).mockResolvedValueOnce(true)

    const error = await deleteConversation(session, CONVERSATION_ID).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toEqual({
      reason: 'legal_hold',
      entityType: 'conversation',
    })
    expect(isCoveredByActiveHold).toHaveBeenCalledWith('org_1', 'conversation', CONVERSATION_ID)
    expect(markConversationDeleting).not.toHaveBeenCalled()
    expect(purgeSessionDocuments).not.toHaveBeenCalled()
    expect(deleteSessionCollection).not.toHaveBeenCalled()
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
    expect(discardConversationDrafts).not.toHaveBeenCalled()
  })

  it('KEEPS the conversation when the external cleanup could not finish', async () => {
    vi.mocked(purgeSessionDocuments).mockResolvedValue({
      ok: false,
      purged: 0,
      retained: 1,
      failures: ['doc-1: object delete failed'],
    })

    await expect(deleteConversation(session, CONVERSATION_ID)).rejects.toThrow(/attachments failed/)

    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })
})

describe('a chat erasure the request could not finish is retried', () => {
  const erased = { ok: true, purged: 0, retained: 0, failures: [] }

  beforeEach(() => {
    stubConversation({ createdBy: 'user_me' })
    vi.mocked(markConversationDeleting).mockResolvedValue({ id: CONVERSATION_ID } as never)
    vi.mocked(purgeSessionDocuments).mockResolvedValue(erased)
    vi.mocked(deleteSessionCollection).mockResolvedValue({ ok: true })
    vi.mocked(recordConversationErased).mockResolvedValue(1)
  })

  it('queues the retry with the mark, in the requester’s name', async () => {
    await deleteConversation(session, CONVERSATION_ID)

    expect(markConversationDeleting).toHaveBeenCalledWith(CONVERSATION_ID, 'org_1', 'user_me')
  })

  it('closes the queued retry only once the rows and the collaboration rows are gone', async () => {
    const order: string[] = []
    vi.mocked(deleteConversationInOrg).mockImplementation(async () => {
      order.push('delete')
    })
    vi.mocked(purgeConversationCollaboration).mockImplementation(async () => {
      order.push('collaboration')
      return { grants: 0, requests: 0, inboxItems: 0 }
    })
    vi.mocked(recordConversationErased).mockImplementation(async () => {
      order.push('record')
      return 1
    })

    await deleteConversation(session, CONVERSATION_ID)

    expect(order).toEqual(['delete', 'collaboration', 'record'])
    expect(recordConversationErased).toHaveBeenCalledWith(CONVERSATION_ID, 'org_1')
  })

  it('leaves the queued retry open when the agent service is down', async () => {
    vi.mocked(deleteSessionCollection).mockResolvedValue({ ok: false, reason: 'fetch failed' })

    await expect(deleteConversation(session, CONVERSATION_ID)).rejects.toBeInstanceOf(UpstreamError)

    expect(recordConversationErased).not.toHaveBeenCalled()
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })

  it('the retry runs the same erasure on a chat marked deleting', async () => {
    stubConversation({ createdBy: 'user_me', deletedAt: new Date('2026-09-01T10:00:00Z') })

    await expect(retryConversationErasure('org_1', CONVERSATION_ID)).resolves.toEqual({
      outcome: 'erased',
    })

    expect(purgeSessionDocuments).toHaveBeenCalledWith(CONVERSATION_ID, 'org_1')
    expect(deleteSessionCollection).toHaveBeenCalledWith(`s_${CONVERSATION_ID}`)
    expect(deleteConversationInOrg).toHaveBeenCalledWith(CONVERSATION_ID, 'org_1')
    expect(purgeConversationCollaboration).toHaveBeenCalledWith(CONVERSATION_ID)
    expect(recordConversationErased).toHaveBeenCalledWith(CONVERSATION_ID, 'org_1')
    expect(discardConversationDrafts).toHaveBeenCalledWith(CONVERSATION_ID)
    expect(markConversationDeleting).not.toHaveBeenCalled()
  })

  it('the retry still fails, and keeps the chat, while the stores fail', async () => {
    stubConversation({ deletedAt: new Date('2026-09-01T10:00:00Z') })
    vi.mocked(purgeSessionDocuments).mockResolvedValue({
      ok: false,
      purged: 0,
      retained: 1,
      failures: ['doc-1: chunk purge failed'],
    })

    await expect(retryConversationErasure('org_1', CONVERSATION_ID)).rejects.toBeInstanceOf(
      UpstreamError
    )
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
    expect(recordConversationErased).not.toHaveBeenCalled()
  })

  it('a hold placed after the mark defers the retry: 409, nothing erased, the chat stays marked', async () => {
    stubConversation({ deletedAt: new Date('2026-09-01T10:00:00Z') })
    vi.mocked(isCoveredByActiveHold).mockResolvedValueOnce(true)

    const error = await retryConversationErasure('org_1', CONVERSATION_ID).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({ reason: 'legal_hold' })
    expect(purgeSessionDocuments).not.toHaveBeenCalled()
    expect(deleteSessionCollection).not.toHaveBeenCalled()
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
    expect(recordConversationErased).not.toHaveBeenCalled()
  })

  it('refuses to erase a chat that is not marked deleting', async () => {
    stubConversation({ deletedAt: null })

    const error = await retryConversationErasure('org_1', CONVERSATION_ID).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toEqual({ reason: 'not_deleting' })
    expect(purgeSessionDocuments).not.toHaveBeenCalled()
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })

  it('refuses a chat of another organization', async () => {
    stubConversation({ organizationId: 'org_other', deletedAt: new Date() })

    await expect(retryConversationErasure('org_1', CONVERSATION_ID)).rejects.toBeInstanceOf(
      NotFoundError
    )
    expect(deleteSessionCollection).not.toHaveBeenCalled()
  })

  it('finishes a chat whose row is already gone instead of failing on it', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue(null)

    await expect(retryConversationErasure('org_1', CONVERSATION_ID)).resolves.toEqual({
      outcome: 'already-gone',
    })
    expect(purgeConversationCollaboration).toHaveBeenCalledWith(CONVERSATION_ID)
    expect(recordConversationErased).toHaveBeenCalledWith(CONVERSATION_ID, 'org_1')
  })
})

describe('deleting a conversation takes its working directory with it', () => {
  beforeEach(() => {
    stubConversation({ visibility: 'private', createdBy: session.userId })
    vi.mocked(markConversationDeleting).mockResolvedValue({ id: CONVERSATION_ID } as never)
    vi.mocked(purgeSessionDocuments).mockResolvedValue({
      ok: true,
      retained: 0,
      failures: [],
    } as never)
  })

  it('asks the agent service to drop the drafts, by conversation id', async () => {
    await deleteConversation(session, CONVERSATION_ID)
    expect(discardConversationDrafts).toHaveBeenCalledWith(CONVERSATION_ID)
  })

  it('does not ask when the delete stopped short of removing the rows', async () => {
    vi.mocked(purgeSessionDocuments).mockResolvedValue({
      ok: false,
      retained: 1,
      failures: ['object store unreachable'],
    } as never)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(deleteConversation(session, CONVERSATION_ID)).rejects.toThrow()
    expect(discardConversationDrafts).not.toHaveBeenCalled()
  })
})
