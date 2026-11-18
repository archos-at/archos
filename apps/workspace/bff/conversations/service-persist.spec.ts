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

import { threadIsAwaitingHuman } from '@/lib/mentions/service'
import type { Message } from '@/lib/db/schema/messages'
import { emitInboxItems } from '@/lib/inbox/service'
import { resolveRequestsOnReply } from '@/lib/mentions/service'
import { countGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { maskChatText } from '@/lib/upload-screening/service'
import { resolveEngagement, resolveEngagementFor } from './engagement'
import { restrictingOtherProjects } from './cross-project-use'
import { lockedConversationIds, peopleWhoMayRead } from './restricted-use'
import { findConversationRead, findMessageInConversation, insertMessages, mergeMessageMetadata, updateConversationMetaInOrg } from './repository'
import { createConversationMessages, generateConversationTitle, persistInternalConversationMessages, updateMessageDetail } from './service'
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

describe('generating a conversation title — severity of a handled failure', () => {
  const titleInput = {
    messages: [{ role: 'user' as const, content: 'Brandschutz im Stiegenhaus?' }],
  }

  function backendReturns(body: unknown, ok = true, status = 200): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }))
    )
  }

  beforeEach(() => {
    stubConversation({ createdBy: 'user_me' })
    vi.mocked(updateConversationMetaInOrg).mockResolvedValue({} as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('logs a handled generation failure as a WARNING, never an error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    backendReturns({ title: '', tags: [], error: 'llm_response_malformed' })

    const result = await generateConversationTitle(session, CONVERSATION_ID, titleInput)

    expect(result).toEqual({ title: '', tags: [], error: 'llm_response_malformed' })
    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[GenerateConversationTitle]'),
      'llm_response_malformed'
    )
    expect(updateConversationMetaInOrg).not.toHaveBeenCalled()
  })

  it('keeps ERROR for a non-2xx, which breaks the always-200 contract', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    backendReturns({ detail: 'boom' }, false, 500)

    const result = await generateConversationTitle(session, CONVERSATION_ID, titleInput)

    expect(result).toEqual({ title: '', tags: [], error: 'backend_error' })
    expect(error).toHaveBeenCalled()
  })

  it('persists a generated title with only known tag keys', async () => {
    backendReturns({ title: 'Brandschutz Stiegenhaus', tags: ['fire_safety', 'nicht-existent'] })

    const result = await generateConversationTitle(session, CONVERSATION_ID, titleInput)

    expect(result).toEqual({ title: 'Brandschutz Stiegenhaus', tags: ['fire_safety'] })
    expect(updateConversationMetaInOrg).toHaveBeenCalledWith(CONVERSATION_ID, 'org_1', {
      title: 'Brandschutz Stiegenhaus',
      tags: ['fire_safety'],
    })
  })
})

describe("the backend's own persist path speaks a different dialect", () => {
  it('marks an answer that read licensed text, also when the asking tab stored the row first (E44)', async () => {
    stubConversation()
    const answer = (id: string) => ({
      id,
      role: 'assistant' as const,
      content: 'Laut Büroexemplar 110 cm.',
      messageType: 'agent_response',
      metadata: { sources: [], licensed_text: true },
    })

    await persistInternalConversationMessages('org_1', CONVERSATION_ID, [answer('msg_server_first')])
    expect(vi.mocked(insertMessages).mock.calls[0][0][0].metadata).toMatchObject({ licensedText: true })
    expect(mergeMessageMetadata).not.toHaveBeenCalled()

    vi.mocked(insertMessages).mockResolvedValueOnce([])
    await persistInternalConversationMessages('org_1', CONVERSATION_ID, [answer('msg_tab_first')])
    expect(mergeMessageMetadata).toHaveBeenCalledWith(CONVERSATION_ID, 'msg_tab_first', { licensedText: true })
  })

  it('merges nothing into a row the tab stored first when the turn read no licensed text', async () => {
    stubConversation()
    vi.mocked(insertMessages).mockResolvedValueOnce([])
    await persistInternalConversationMessages('org_1', CONVERSATION_ID, [
      { id: 'msg_plain', role: 'assistant', content: 'Laut OIB-RL 4 100 cm.', metadata: { sources: [] } },
    ])
    expect(mergeMessageMetadata).not.toHaveBeenCalled()
  })

  it('stores the backend answer metadata as citations + provenance', async () => {
    stubConversation()

    await persistInternalConversationMessages('org_1', CONVERSATION_ID, [
      {
        id: 'msg_agent',
        role: 'assistant',
        content: 'Die erforderliche Stiegenlaufbreite beträgt 1,20 m.',
        messageType: 'agent_response',
        metadata: {
          sources: [
            {
              document_id: 'oib-rl-4:2019',
              file_name: 'OIB-RL-4.pdf',
              page: 12,
              source_type: 'knowledge_layer',
              origin: 'kb',
            },
          ],
          answer_confidence: 'medium',
          answer_confidence_reason: 'Direkt aus OIB-RL 4 belegt.',
        },
      },
    ])

    const [row] = vi.mocked(insertMessages).mock.calls[0][0]
    expect(row.metadata).toMatchObject({
      citations: {
        v: 1,
        sources: [
          {
            document_id: 'oib-rl-4:2019',
            file_name: 'OIB-RL-4.pdf',
            page: 12,
            source_type: 'knowledge_layer',
            origin: 'kb',
          },
        ],
      },
      provenance: {
        answerConfidence: 'medium',
        answerConfidenceReason: 'Direkt aus OIB-RL 4 belegt.',
      },
    })
    expect(row.metadata).not.toHaveProperty('sources')
    expect(row.metadata).not.toHaveProperty('answer_confidence')
  })
})

describe('what a person wrote is stored masked (ADR-0086, chat screening)', () => {
  const IBAN = 'AT61 1904 3002 3457 3201'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("stores a user message masked against the office's policy", async () => {
    stubConversation({ createdBy: 'user_me' })

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: `Lohnzettel anbei, IBAN ${IBAN}` },
    ])

    const rows = vi.mocked(insertMessages).mock.calls[0][0]
    expect(rows[0].content).toBe('[Begriff entfernt] anbei, IBAN [IBAN entfernt]')
    expect(maskChatText).toHaveBeenCalledWith('org_1', `Lohnzettel anbei, IBAN ${IBAN}`)
  })

  it('masks numbers whatever role the client gave it, since the role is the client\'s word too', async () => {
    stubConversation({ createdBy: 'user_me' })

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_2', role: 'assistant', content: `Die IBAN ${IBAN} steht im Vertrag.` },
      { id: 'msg_3', role: 'system', content: 'Lohnzettel liegt bei.' },
    ])

    const rows = vi.mocked(insertMessages).mock.calls[0][0]
    expect(rows.map((row) => row.content)).toEqual([
      'Die IBAN [IBAN entfernt] steht im Vertrag.',
      'Lohnzettel liegt bei.',
    ])
  })

  it("stores the agent's answer that names a listed term as it read live, numbers masked", async () => {
    stubConversation({ createdBy: 'user_me' })

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_5', role: 'assistant', content: `Es gibt keine Honorarvereinbarung; Konto ${IBAN}.` },
    ])

    expect(vi.mocked(insertMessages).mock.calls[0][0][0].content).toBe(
      'Es gibt keine Honorarvereinbarung; Konto [IBAN entfernt].'
    )
  })

  it('stores a typed answer carried in a new message\'s metadata masked and bounded', async () => {
    stubConversation({ createdBy: 'user_me' })

    await createConversationMessages(session, CONVERSATION_ID, [
      {
        id: 'msg_4',
        role: 'assistant',
        content: 'Welches Konto?',
        metadata: { promptState: { response: `Konto ${IBAN}`, smuggled: 'x' } },
      },
    ])

    const stored = vi.mocked(insertMessages).mock.calls[0][0][0].metadata as {
      promptState: { response: string; smuggled?: string }
    }
    expect(stored.promptState.response).toBe('Konto [IBAN entfernt]')
    expect(stored.promptState).not.toHaveProperty('smuggled')
  })

  it("stores a typed answer to the agent's question masked", async () => {
    stubConversation({ createdBy: 'user_me' })
    vi.mocked(mergeMessageMetadata).mockResolvedValue({ id: 'msg_q' } as never)

    await updateMessageDetail(session, CONVERSATION_ID, 'msg_q', {
      promptState: { response: `Bitte an ${IBAN}, Honorarvereinbarung folgt` },
    })

    const [, , metadata] = vi.mocked(mergeMessageMetadata).mock.calls[0]
    expect((metadata as { promptState: { response: string } }).promptState.response).toBe(
      'Bitte an [IBAN entfernt], [Begriff entfernt] folgt'
    )
  })

  it('stores a message the composer already masked unchanged', async () => {
    stubConversation({ createdBy: 'user_me' })

    await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: 'Bitte überweise an [IBAN entfernt]' },
    ])

    expect(vi.mocked(insertMessages).mock.calls[0][0][0].content).toBe('Bitte überweise an [IBAN entfernt]')
  })

  it('masks a job prompt the backend writes as a user turn', async () => {
    stubConversation()

    await persistInternalConversationMessages('org_1', CONVERSATION_ID, [
      { id: 'msg_q', role: 'user', content: `Prüfe Konto ${IBAN}`, messageType: 'user_message' },
    ])

    expect(vi.mocked(insertMessages).mock.calls[0][0][0].content).toBe('Prüfe Konto [IBAN entfernt]')
  })

  it("masks the user's turns before the opening exchange goes to the naming model", async () => {
    stubConversation({ createdBy: 'user_me' })
    vi.mocked(updateConversationMetaInOrg).mockResolvedValue({} as never)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ title: 'Konto', tags: [] }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await generateConversationTitle(session, CONVERSATION_ID, {
      messages: [
        { role: 'user', content: `Konto ${IBAN}?` },
        { role: 'assistant', content: 'Welches Projekt?' },
      ],
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).messages).toEqual([
      { role: 'user', content: 'Konto [IBAN entfernt]?' },
      { role: 'assistant', content: 'Welches Projekt?' },
    ])
  })

  it('masks a client-supplied assistant turn before it goes to the naming model', async () => {
    stubConversation({ createdBy: 'user_me' })
    vi.mocked(updateConversationMetaInOrg).mockResolvedValue({} as never)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ title: 'Konto', tags: [] }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await generateConversationTitle(session, CONVERSATION_ID, {
      messages: [
        { role: 'user', content: 'Welches Konto?' },
        { role: 'assistant', content: `Das Konto ${IBAN} aus dem Lohnzettel.` },
      ],
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).messages[1]).toEqual({
      role: 'assistant',
      content: 'Das Konto [IBAN entfernt] aus dem [Begriff entfernt].',
    })
  })
})
