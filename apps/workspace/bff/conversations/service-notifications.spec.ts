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

vi.mock('@/lib/events/bus', () => ({ publishToUsers: vi.fn() }))

vi.mock('@/lib/inbox/service', () => ({
  emitInboxItems: vi.fn(),
  markResourceItemsReadFor: vi.fn(),
}))

vi.mock('@/lib/mentions/service', () => ({
  applyMessageMentions: vi.fn(),
  resolveRequestsOnReply: vi.fn(),
  threadIsAwaitingHuman: vi.fn(),
}))

vi.mock('@/lib/upload-screening/service', async () => {
  const { buildContentRules, chatScreeningRules, maskText } = await import('@/lib/upload-screening/content-screen')
  const { SUGGESTED_SCREENING_POLICY } = await import('@/lib/upload-screening/policy')
  return {
    maskChatText: vi.fn(async (_organizationId: string, text: string) =>
      maskText(text, chatScreeningRules(SUGGESTED_SCREENING_POLICY))
    ),
    maskAnswerText: vi.fn(async (_organizationId: string, text: string) =>
      maskText(text, buildContentRules([], SUGGESTED_SCREENING_POLICY.detectors))
    ),
  }
})

vi.mock('./engagement', () => ({
  resolveEngagement: vi.fn(),
  resolveEngagementFor: vi.fn(),
  setEngagement: vi.fn(),
}))

import { NotFoundError } from '@/lib/api/errors'
import { featureDisabledProblem } from '@/lib/authz/feature-disabled'
import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { threadIsAwaitingHuman } from '@/lib/mentions/service'
import type { Message } from '@/lib/db/schema/messages'
import { publishToUsers } from '@/lib/events/bus'
import { emitInboxItems, markResourceItemsReadFor } from '@/lib/inbox/service'
import { applyMessageMentions, resolveRequestsOnReply } from '@/lib/mentions/service'
import { countGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { resolveEngagement, resolveEngagementFor } from './engagement'
import { restrictingOtherProjects } from './cross-project-use'
import { lockedConversationIds, peopleWhoMayRead } from './restricted-use'
import { findConversationRead, findMessageInConversation, insertMessages, upsertConversationRead } from './repository'
import { createConversationMessages, markConversationRead } from './service'
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

describe('participant fan-out (spec CC-9, CC-20, NF-8)', () => {
  it('emits NOTHING for a solo thread — private, no grants', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_me' })
    vi.mocked(countGrantsForResource).mockResolvedValue(0)

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Frage' },
    ])

    expect(publishToUsers).not.toHaveBeenCalled()
    expect(emitInboxItems).not.toHaveBeenCalled()
    expect(resolveParticipants).not.toHaveBeenCalled()
  })

  it('tells participants about the message and the turn it opened', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_me' })
    vi.mocked(resolveParticipants).mockResolvedValue(['user_me', 'user_anna'])

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Frage' },
      { id: 'msg_2', role: 'assistant', content: 'Antwort' },
    ])

    const events = vi
      .mocked(publishToUsers)
      .mock.calls.map(([recipients, event]) => ({ recipients, event }))
    expect(events).toEqual([
      {
        recipients: ['user_me', 'user_anna'],
        event: {
          kind: 'conversation.message',
          conversationId: CONVERSATION_ID,
          authorUserId: 'user_me',
          messageId: 'msg_1',
        },
      },
      {
        recipients: ['user_me', 'user_anna'],
        event: {
          kind: 'conversation.turn',
          conversationId: CONVERSATION_ID,
          phase: 'started',
          actorUserId: 'user_me',
        },
      },
      {
        recipients: ['user_me', 'user_anna'],
        event: {
          kind: 'conversation.message',
          conversationId: CONVERSATION_ID,
          authorUserId: null,
          messageId: 'msg_2',
        },
      },
      {
        recipients: ['user_me', 'user_anna'],
        event: {
          kind: 'conversation.turn',
          conversationId: CONVERSATION_ID,
          phase: 'ended',
          actorUserId: 'user_me',
        },
      },
    ])
  })

  it('folds ONE collapsing ambient item per participant, not one per message', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_me' })
    vi.mocked(resolveParticipants).mockResolvedValue(['user_me', 'user_anna'])

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'eins' },
      { id: 'msg_2', role: 'user', content: 'zwei' },
      { id: 'msg_3', role: 'user', content: 'drei' },
    ])

    expect(emitInboxItems).toHaveBeenCalledTimes(1)
    const emissions = vi.mocked(emitInboxItems).mock.calls[0][0]
    expect(emissions).toHaveLength(2)
    expect(emissions.every((item) => item.type === 'conversation.activity')).toBe(true)
    expect(new Set(emissions.map((item) => item.groupKey))).toEqual(
      new Set(['conversation.activity:conversation:conv_1'])
    )
    expect(emissions.every((item) => item.actorUserId === 'user_me')).toBe(true)
  })

  it("names the thread in every recipient's row, so the inbox is not ten identical lines", async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_me' })
    vi.mocked(resolveParticipants).mockResolvedValue(['user_me', 'user_anna'])

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Frage' },
    ])

    const emissions = vi.mocked(emitInboxItems).mock.calls[0][0]
    expect(emissions.map((item) => [item.recipientUserId, item.payload])).toEqual([
      ['user_me', { subject: 'Brandschutz Stiegenhaus' }],
      ['user_anna', { subject: 'Brandschutz Stiegenhaus' }],
    ])
  })

  it('never fails the message write because notification failed', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_me' })
    vi.mocked(resolveParticipants).mockResolvedValue(['user_anna'])
    vi.mocked(emitInboxItems).mockRejectedValue(new Error('inbox down'))

    const persisted = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Frage' },
    ])

    expect(persisted).toHaveLength(1)
  })
})

describe('the collaboration flag is off (spec NF-8, NF-7)', () => {
  beforeEach(() => {
    session.featureFlags = []
  })
  afterEach(() => {
    session.featureFlags = ['collaboration']
  })

  it('refuses a message carrying mentions, and grants/asks/notifies nobody', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_me' })

    const failure = await createConversationMessages(session, CONVERSATION_ID, [
      {
        id: 'msg_1',
        role: 'user',
        content: '@Anna richtig?',
        mentions: [{ targetId: 'user_anna' }],
      },
    ]).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(FeatureDisabledError)
    expect((failure as FeatureDisabledError).problem).toEqual(featureDisabledProblem('collaboration'))
    expect(applyMessageMentions).not.toHaveBeenCalled()
    expect(insertMessages).not.toHaveBeenCalled()
    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('still persists an ordinary message exactly as before, agent addressed', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_me' })

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Welche OIB-Richtlinie gilt hier?' },
    ])

    expect(persisted.id).toBe('msg_1')
    expect(persisted.addressees).toEqual({ agent: true, users: [] })
    expect(insertMessages).toHaveBeenCalled()
  })

  it('records the read mark but never touches the inbox', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_other' })
    vi.mocked(upsertConversationRead).mockResolvedValue({} as never)

    await markConversationRead(session, CONVERSATION_ID, { lastReadMessageId: 'msg_9' })

    expect(upsertConversationRead).toHaveBeenCalled()
    expect(markResourceItemsReadFor).not.toHaveBeenCalled()
  })
})

describe('read state (spec CC-18, IB-9)', () => {
  it('moves the caller mark and clears ambient items only', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_other' })
    vi.mocked(upsertConversationRead).mockResolvedValue({
      conversationId: CONVERSATION_ID,
      organizationId: 'org_1',
      userId: 'user_me',
      lastReadAt: new Date('2026-07-02T12:00:00Z'),
      lastReadMessageId: 'msg_9',
      updatedAt: new Date('2026-07-02T12:00:00Z'),
    })

    const mark = await markConversationRead(session, CONVERSATION_ID, {
      lastReadMessageId: 'msg_9',
    })

    expect(upsertConversationRead).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      userId: 'user_me',
      lastReadMessageId: 'msg_9',
    })
    expect(markResourceItemsReadFor).toHaveBeenCalledWith(session, 'conversation', CONVERSATION_ID)
    expect(resolveRequestsOnReply).not.toHaveBeenCalled()
    expect(mark.lastReadMessageId).toBe('msg_9')
  })

  it('lets a VIEWER mark read — reading is not contributing', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })
    vi.mocked(findGrantForSubject).mockResolvedValue({ role: 'viewer' } as never)
    vi.mocked(upsertConversationRead).mockResolvedValue({} as never)

    await expect(markConversationRead(session, CONVERSATION_ID)).resolves.toBeDefined()
  })

  it('404s a mark on a conversation the caller cannot see', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })

    await expect(markConversationRead(session, CONVERSATION_ID)).rejects.toThrow(NotFoundError)
    expect(upsertConversationRead).not.toHaveBeenCalled()
  })
})
