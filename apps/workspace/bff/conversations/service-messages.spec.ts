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

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { requireProjectAccess, type ProjectRole } from '@/lib/authz/projects'
import { threadIsAwaitingHuman } from '@/lib/mentions/service'
import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import type { Message } from '@/lib/db/schema/messages'
import { publishToUsers } from '@/lib/events/bus'
import { emitInboxItems } from '@/lib/inbox/service'
import { applyMessageMentions, resolveRequestsOnReply } from '@/lib/mentions/service'
import { countGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { resolveEngagement, resolveEngagementFor, setEngagement } from './engagement'
import { restrictingOtherProjects } from './cross-project-use'
import { lockedConversationIds, peopleWhoMayRead } from './restricted-use'
import { findConversationRead, findMessageInConversation, insertMessages, listMessagePage } from './repository'
import { createConversationMessages, listConversationMessages } from './service'
import { PRODUCT_NAME } from '@/lib/brand'
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

describe('message authorship (spec CC-3, MG-3)', () => {
  it('stamps a user message with WHICH person wrote it, and never the agent', async () => {
    stubConversation({ createdBy: 'user_me' })

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Frage' },
      { id: 'msg_2', role: 'assistant', content: 'Antwort' },
    ])

    const rows = vi.mocked(insertMessages).mock.calls[0][0]
    expect(rows[0]).toMatchObject({ id: 'msg_1', role: 'user', authorUserId: 'user_me' })
    expect(rows[1]).toMatchObject({ id: 'msg_2', role: 'assistant', authorUserId: null })
  })

  it('attributes a legacy authorless user message to the creator AT READ TIME', async () => {
    stubConversation({ createdBy: 'user_creator', visibility: 'project' })
    vi.mocked(listMessagePage).mockResolvedValue({
      rows: [
        messageRow({ id: 'legacy_user', role: 'user', authorUserId: null }),
        messageRow({ id: 'legacy_agent', role: 'assistant', authorUserId: null }),
        messageRow({ id: 'stamped', role: 'user', authorUserId: 'user_me' }),
      ],
      hasMore: false,
    })

    const { messages } = await listConversationMessages(session, CONVERSATION_ID)

    expect(messages[0].authorUserId).toBe('user_creator')
    expect(vi.mocked(listMessagePage).mock.results).toHaveLength(1)
    expect(messages[1].authorUserId).toBeNull()
    expect(messages[2].authorUserId).toBe('user_me')
  })
})

describe('the addressee ruling (spec MN-1, MN-2, MN-7)', () => {
  beforeEach(() => {
    stubConversation({ createdBy: 'user_me', visibility: 'project' })
  })

  it('does NOT wake the agent for a plain message while the thread awaits a human', async () => {
    vi.mocked(threadIsAwaitingHuman).mockResolvedValue(true)

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Ja, das passt so.' },
    ])

    expect(persisted.addressees).toEqual({ agent: false, users: [] })
  })

  it('asks the agent again once the wait has cleared', async () => {
    vi.mocked(threadIsAwaitingHuman).mockResolvedValue(false)

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Und wie sieht es im EG aus?' },
    ])

    expect(persisted.addressees).toEqual({ agent: true, users: [] })
  })

  it('sends a plain message to the chat, not to the agent, in a mention-mode thread', async () => {
    vi.mocked(resolveEngagementFor).mockResolvedValue({
      mode: 'mention',
      stored: 'mention',
      suggestion: null,
    })

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Danke Anna, dann nehmen wir 1,20 m.' },
    ])

    expect(persisted.addressees).toEqual({ agent: false, users: [] })
  })

  it('still answers a plain message in an ask-mode thread — the default is unchanged', async () => {
    vi.mocked(resolveEngagementFor).mockResolvedValue({
      mode: 'ask',
      stored: null,
      suggestion: null,
    })

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Und wie sieht es im EG aus?' },
    ])

    expect(persisted.addressees).toEqual({ agent: true, users: [] })
  })

  it('an outstanding wait outranks the mode — a waiting thread is asking nobody', async () => {
    vi.mocked(threadIsAwaitingHuman).mockResolvedValue(true)
    vi.mocked(resolveEngagementFor).mockResolvedValue({
      mode: 'ask',
      stored: 'ask',
      suggestion: null,
    })

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Kein Stress, wann du dazu kommst.' },
    ])

    expect(persisted.addressees).toEqual({ agent: false, users: [] })
    expect(resolveEngagementFor).not.toHaveBeenCalled()
  })

  it('resolves the mode at most once for a batch, however many messages it carries', async () => {
    vi.mocked(resolveEngagementFor).mockResolvedValue({
      mode: 'mention',
      stored: null,
      suggestion: null,
    })

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Erstens…' },
      { id: 'msg_2', role: 'user', content: 'Zweitens…' },
    ])

    expect(resolveEngagementFor).toHaveBeenCalledTimes(1)
  })

  it('writing a message never changes the thread\u2019s own mode', async () => {
    vi.mocked(resolveEngagementFor).mockResolvedValue({
      mode: 'ask',
      stored: null,
      suggestion: 'mention',
    })

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Passt.' },
    ])

    expect(persisted.addressees).toEqual({ agent: true, users: [] })
    expect(setEngagement).not.toHaveBeenCalled()
  })

  it('never pays for the awaiting lookup on a solo thread', async () => {
    stubConversation({ createdBy: 'user_me', visibility: 'private' })
    vi.mocked(threadIsAwaitingHuman).mockResolvedValue(true)

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Frage an den Agenten' },
    ])

    expect(threadIsAwaitingHuman).not.toHaveBeenCalled()
    expect(persisted.addressees).toEqual({ agent: true, users: [] })
  })

  it('addresses the agent when a message carries no mentions', async () => {
    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Frage' },
    ])

    expect(persisted.addressees).toEqual({ agent: true, users: [] })
    expect(applyMessageMentions).not.toHaveBeenCalled()
    expect(vi.mocked(insertMessages).mock.calls[0][0][0].metadata).toMatchObject({
      addressees: { agent: true, users: [] },
    })
  })

  it('hands off to a human — the agent is NOT addressed, so no turn is opened', async () => {
    vi.mocked(applyMessageMentions).mockResolvedValue({
      addressees: { agent: false, users: ['user_anna'] },
      createdRequests: 1,
      awaitingUserIds: ['user_anna'],
    })
    vi.mocked(resolveParticipants).mockResolvedValue(['user_me', 'user_anna'])

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      {
        id: 'msg_1',
        role: 'user',
        content: '@Anna richtig?',
        mentions: [{ targetId: 'user_anna' }],
      },
    ])

    expect(persisted.addressees).toEqual({ agent: false, users: ['user_anna'] })
    expect(persisted.createdRequests).toBe(1)
    expect(applyMessageMentions).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: CONVERSATION_ID, anchorId: 'msg_1' })
    )
    const turnEvents = vi
      .mocked(publishToUsers)
      .mock.calls.filter(([, event]) => event.kind === 'conversation.turn')
    expect(turnEvents).toHaveLength(0)
  })

  it('re-uses the ruling a replayed message id already stored, without asking again', async () => {
    vi.mocked(findMessageInConversation).mockResolvedValue(
      messageRow({ metadata: { addressees: { agent: false, users: ['user_anna'] } } })
    )

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      {
        id: 'msg_1',
        role: 'user',
        content: '@Anna richtig?',
        mentions: [{ targetId: 'user_anna' }],
      },
    ])

    expect(applyMessageMentions).not.toHaveBeenCalled()
    expect(persisted.addressees).toEqual({ agent: false, users: ['user_anna'] })
  })

  it('closes what the author was asked, because they just contributed (MN-9.1)', async () => {
    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Ja, stimmt.' },
    ])

    expect(resolveRequestsOnReply).toHaveBeenCalledWith({
      organizationId: 'org_1',
      resourceType: 'conversation',
      resourceId: CONVERSATION_ID,
      authorUserId: 'user_me',
      addressedUserIds: [],
    })
  })

  it('passes on who the reply addressed, so a question back is not filed as an answer', async () => {
    await createConversationMessages(session, CONVERSATION_ID, [
      {
        id: 'msg_1',
        role: 'user',
        content: '@Anna welche Halle meinst du?',
        mentions: [{ targetId: 'user_anna' }],
      },
    ])

    expect(resolveRequestsOnReply).toHaveBeenCalledWith(
      expect.objectContaining({ addressedUserIds: ['user_anna'] })
    )
  })

  it('does not close anything for a message the agent wrote', async () => {
    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'assistant', content: 'Antwort' },
    ])

    expect(resolveRequestsOnReply).not.toHaveBeenCalled()
  })
})

describe("the addressee ruling is the SERVER's, and only the server's (spec MN-2)", () => {
  it('strips a client-supplied `addressees` from metadata on a NON-user row', async () => {
    stubConversation({ visibility: 'project', createdBy: session.userId })

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      {
        id: 'msg_1',
        role: 'assistant',
        content: 'Antwort',
        messageType: 'agent_response',
        metadata: {
          addressees: { agent: false, users: ['user_victim'] },
          cards: [{ kind: 'memory_proposal' }],
        },
      },
    ])

    const metadata = persisted.metadata as Record<string, unknown>
    expect(metadata.addressees).toBeUndefined()
    expect(metadata.cards).toEqual([{ kind: 'memory_proposal' }])
    expect(metadata.messageType).toBe('agent_response')
  })

  it("overwrites a client-supplied ruling on a USER row with the server's own", async () => {
    stubConversation({ visibility: 'project', createdBy: session.userId })
    vi.mocked(applyMessageMentions).mockResolvedValue({
      addressees: { agent: false, users: ['user_anna'] },
      createdRequests: 1,
      awaitingUserIds: ['user_anna'],
    })

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      {
        id: 'msg_1',
        role: 'user',
        content: '@Anna richtig?',
        mentions: [{ targetId: 'user_anna' }],
        metadata: { addressees: { agent: true, users: ['user_victim'] } },
      },
    ])

    expect((persisted.metadata as Record<string, unknown>).addressees).toEqual({
      agent: false,
      users: ['user_anna'],
    })
  })
})

describe('project:chat gates the AGENT, not the conversation (the message-write hole)', () => {
  const asViewer = (): void => {
    vi.mocked(requireProjectAccess).mockImplementation(async (_s, _id, permission) => {
      const accepted = Array.isArray(permission) ? permission : [permission]
      if (accepted.includes('project:view')) return { role: 'project-viewer' as ProjectRole, closed: false, readsBecauseClosed: false }
      throw new NotFoundError()
    })
  }

  beforeEach(() => {
    stubConversation({ createdBy: 'user_me', visibility: 'project' })
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-viewer', closed: false, readsBecauseClosed: false })
  })

  it('refuses a message addressed to the agent when the project denies project:chat', async () => {
    asViewer()

    await expect(
      createConversationMessages(session, CONVERSATION_ID, [
        { id: 'msg_1', role: 'user', content: 'Und wie sieht es im EG aus?' },
      ])
    ).rejects.toThrow(`ask ${PRODUCT_NAME}`)

    await expect(
      createConversationMessages(session, CONVERSATION_ID, [
        { id: 'msg_2', role: 'user', content: 'Nochmal bitte.' },
      ])
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('checks project:chat, not project:view', async () => {
    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Und wie sieht es im EG aus?' },
    ])

    expect(requireProjectAccess).toHaveBeenCalledWith(session, PROJECT_ID, [
      'project:chat',
      'project:edit',
    ])
  })

  it('persists NOTHING when the turn is refused', async () => {
    asViewer()

    await expect(
      createConversationMessages(session, CONVERSATION_ID, [
        { id: 'msg_1', role: 'user', content: 'Und wie sieht es im EG aus?' },
      ])
    ).rejects.toThrow()

    expect(insertMessages).not.toHaveBeenCalled()
  })

  it('still lets a Viewer reply to a COLLEAGUE — the gate is on the agent alone', async () => {
    vi.mocked(resolveEngagementFor).mockResolvedValue({
      mode: 'mention',
      stored: 'mention',
      suggestion: null,
    })
    asViewer()

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Danke Anna, dann nehmen wir 1,20 m.' },
    ])

    expect(persisted.addressees).toEqual({ agent: false, users: [] })
    expect(insertMessages).toHaveBeenCalled()
  })

  it('refuses an explicit mention of the agent BEFORE applying its mentions', async () => {
    asViewer()

    await expect(
      createConversationMessages(session, CONVERSATION_ID, [
        {
          id: 'msg_1',
          role: 'user',
          content: '@Agent und wie sieht es im EG aus?',
          mentions: [{ targetId: AGENT_MENTION_ID }],
        },
      ])
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(applyMessageMentions).not.toHaveBeenCalled()
    expect(insertMessages).not.toHaveBeenCalled()
  })

  it('still applies mentions when the caller MAY chat', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor', closed: false, readsBecauseClosed: false })

    await createConversationMessages(session, CONVERSATION_ID, [
      {
        id: 'msg_1',
        role: 'user',
        content: '@Agent und wie sieht es im EG aus?',
        mentions: [{ targetId: AGENT_MENTION_ID }],
      },
    ])

    expect(applyMessageMentions).toHaveBeenCalled()
    expect(insertMessages).toHaveBeenCalled()
  })

  it('does not consult the project at all for a thread outside one', async () => {
    stubConversation({ createdBy: 'user_me', visibility: 'private', projectId: null })
    vi.mocked(requireProjectAccess).mockClear()

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Allgemeine Frage.' },
    ])

    expect(requireProjectAccess).not.toHaveBeenCalled()
  })
})
