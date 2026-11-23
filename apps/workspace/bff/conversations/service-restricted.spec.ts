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

vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn(async () => new Map()) }))

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

import { NotFoundError, ResourceRightsLostError } from '@/lib/api/errors'
import { threadIsAwaitingHuman } from '@/lib/mentions/service'
import type { Message } from '@/lib/db/schema/messages'
import { emitInboxItems } from '@/lib/inbox/service'
import { resolveRequestsOnReply } from '@/lib/mentions/service'
import { countGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { deleteSessionCollection, purgeSessionDocuments } from '@/lib/session-documents/cleanup'
import { resolveEngagement, resolveEngagementFor } from './engagement'
import { restrictingOtherProjects } from './cross-project-use'
import { lockedConversationIds, peopleWhoMayRead } from './restricted-use'
import { deleteConversationInOrg, findConversationInOrg, findConversationRead, findMessageInConversation, insertMessages, listMessagePage, listVisibleConversations, markConversationDeleting, updateConversationTitleInOrg } from './repository'
import { createConversationMessages, deleteConversation, getConversation, listConversationMessages, listConversations, markConversationRead, updateConversationTitle } from './service'
import { CONVERSATION_ID, PROJECT_ID, session, stubConversation, stubContainer, messageRow } from './service.fixtures'

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

describe('the other projects that restrict a chat (ADR-0094)', () => {
  const GRAZ = { id: '22222222-0000-4000-8000-000000000002', name: 'Wohnbau Graz' }

  it('puts the server’s current record on the detail, asked for this conversation in this organization', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_me' })
    vi.mocked(restrictingOtherProjects).mockResolvedValue([GRAZ])

    const conversation = await getConversation(session, CONVERSATION_ID)

    expect(conversation.restrictingOtherProjects).toEqual([GRAZ])
    expect(restrictingOtherProjects).toHaveBeenCalledWith(CONVERSATION_ID, session.organizationId)
  })

  it('says none for a chat that drew on no other project', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_me' })
    expect((await getConversation(session, CONVERSATION_ID)).restrictingOtherProjects).toEqual([])
  })

  it('does not look at the record for a caller who may not read the conversation', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })
    vi.mocked(restrictingOtherProjects).mockResolvedValue([GRAZ])

    await expect(getConversation(session, CONVERSATION_ID)).rejects.toThrow(NotFoundError)
    expect(restrictingOtherProjects).not.toHaveBeenCalled()
  })
})

describe('a chat the reader may no longer read (ADR-0088)', () => {
  function lockFor(...locked: string[]): void {
    vi.mocked(peopleWhoMayRead).mockImplementation(async (_org, _id, userIds) =>
      new Set(userIds.filter((userId) => !locked.includes(userId)))
    )
  }

  const row = (id: string, title: string) =>
    ({
      id,
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      createdBy: 'user_me',
      title,
      tags: ['fire_safety'],
      visibility: 'private',
      engagement: null,
      jobId: null,
      subjectResourceType: 'document',
      subjectResourceId: 'doc_9',
      deletedAt: null,
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-02T10:00:00Z'),
    }) as never

  beforeEach(() => {
    vi.mocked(peopleWhoMayRead).mockImplementation(async (_org, _id, userIds) => new Set(userIds))
  })

  describe('the list keeps it, under a neutral title', () => {
    it('sends no title, topic tags or subject for a locked chat, and the rest of the row as it was', async () => {
      vi.mocked(listVisibleConversations).mockResolvedValue([
        row('s_locked', 'Kündigung Müller: Honorarfolder'),
        row('s_open', 'Brandschutz Stiegenhaus'),
      ])
      vi.mocked(lockedConversationIds).mockResolvedValue(new Set(['s_locked']))

      const { conversations: listed } = await listConversations(session, { projectId: PROJECT_ID })

      const locked = listed.find((entry) => entry.id === 's_locked')
      expect(locked).toMatchObject({
        contentLocked: true,
        title: null,
        tags: [],
        subjectResourceType: null,
        subjectResourceId: null,
        createdBy: 'user_me',
        updatedAt: new Date('2026-07-02T10:00:00Z'),
      })
      expect(JSON.stringify(locked)).not.toContain('Müller')
      expect(listed.find((entry) => entry.id === 's_open')).toMatchObject({
        contentLocked: false,
        title: 'Brandschutz Stiegenhaus',
        tags: ['fire_safety'],
        subjectResourceId: 'doc_9',
      })
    })

    it('asks about every row of the list at once, with its project', async () => {
      vi.mocked(listVisibleConversations).mockResolvedValue([row('s_a', 'A'), row('s_b', 'B')])
      vi.mocked(lockedConversationIds).mockResolvedValue(new Set())

      await listConversations(session, { projectId: PROJECT_ID })

      expect(lockedConversationIds).toHaveBeenCalledTimes(1)
      expect(lockedConversationIds).toHaveBeenCalledWith(session, [
        { id: 's_a', projectId: PROJECT_ID },
        { id: 's_b', projectId: PROJECT_ID },
      ])
    })

    it('brings the real title back when the role is given back: nothing was rewritten', async () => {
      vi.mocked(listVisibleConversations).mockResolvedValue([row('s_locked', 'Brandschutz Stiegenhaus')])
      vi.mocked(lockedConversationIds).mockResolvedValueOnce(new Set(['s_locked']))
      expect((await listConversations(session)).conversations[0]).toMatchObject({ contentLocked: true, title: null })

      vi.mocked(lockedConversationIds).mockResolvedValueOnce(new Set())
      expect((await listConversations(session)).conversations[0]).toMatchObject({
        contentLocked: false,
        title: 'Brandschutz Stiegenhaus',
      })
    })
  })

  describe.each([
    ['a grantee', { createdBy: 'user_other' }, true],
    ['the CREATOR', { createdBy: 'user_me' }, false],
  ])('opening it as %s', (_who, tenancy, granted) => {
    beforeEach(() => {
      stubConversation({ visibility: 'private', ...tenancy })
      if (granted) vi.mocked(findGrantForSubject).mockResolvedValue({ role: 'collaborator' } as never)
      lockFor('user_me')
    })

    it('answers the typed 403 for the detail, and reads no row', async () => {
      await expect(getConversation(session, CONVERSATION_ID)).rejects.toBeInstanceOf(ResourceRightsLostError)
      expect(findConversationInOrg).not.toHaveBeenCalled()
      expect(restrictingOtherProjects).not.toHaveBeenCalled()
    })

    it('answers the typed 403 for the messages, and reads none of them', async () => {
      await expect(listConversationMessages(session, CONVERSATION_ID)).rejects.toBeInstanceOf(ResourceRightsLostError)
      expect(listMessagePage).not.toHaveBeenCalled()
    })

    it('refuses a message into it, and stores nothing', async () => {
      await expect(
        createConversationMessages(session, CONVERSATION_ID, [{ id: 'm_1', role: 'user', content: 'Und jetzt?' }])
      ).rejects.toBeInstanceOf(ResourceRightsLostError)
      expect(insertMessages).not.toHaveBeenCalled()
    })

    it('refuses a rename and a read mark: both act on the chat', async () => {
      await expect(updateConversationTitle(session, CONVERSATION_ID, 'Neu')).rejects.toBeInstanceOf(
        granted ? NotFoundError : ResourceRightsLostError
      )
      await expect(markConversationRead(session, CONVERSATION_ID)).rejects.toBeInstanceOf(ResourceRightsLostError)
      expect(updateConversationTitleInOrg).not.toHaveBeenCalled()
    })

    it('opens again, whole, once the role is given back', async () => {
      lockFor()
      vi.mocked(listMessagePage).mockResolvedValue({ rows: [messageRow()], hasMore: false })

      await expect(getConversation(session, CONVERSATION_ID)).resolves.toMatchObject({ id: CONVERSATION_ID })
      await expect(listConversationMessages(session, CONVERSATION_ID)).resolves.toMatchObject({ messages: [{}], nextCursor: null })
    })
  })

  it('opens a PROJECT-visible chat as locked for a member whose roles do not reach what it drew on', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_other' })
    lockFor('user_me')

    await expect(listConversationMessages(session, CONVERSATION_ID)).rejects.toBeInstanceOf(ResourceRightsLostError)
  })

  it('still lets the owner delete a chat they may no longer read', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_me' })
    vi.mocked(markConversationDeleting).mockResolvedValue({ id: CONVERSATION_ID } as never)
    vi.mocked(purgeSessionDocuments).mockResolvedValue({ ok: true, purged: 0, retained: 0, failures: [] })
    vi.mocked(deleteSessionCollection).mockResolvedValue({ ok: true })
    lockFor('user_me')

    await expect(deleteConversation(session, CONVERSATION_ID)).resolves.not.toThrow()
    expect(deleteConversationInOrg).toHaveBeenCalled()
  })

  it('carries nothing of the content in the refusal: no title, no folder', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_me' })
    lockFor('user_me')

    const error = await getConversation(session, CONVERSATION_ID).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ResourceRightsLostError)
    expect(JSON.stringify({ message: (error as Error).message, details: (error as ResourceRightsLostError).details })).toBe(
      JSON.stringify({
        message: 'You no longer have the rights to view this content.',
        details: { reason: 'rights-lost', resourceType: 'conversation' },
      })
    )
  })
})
