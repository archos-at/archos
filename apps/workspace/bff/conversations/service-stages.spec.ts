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

vi.mock('./engagement', () => ({
  resolveEngagement: vi.fn(),
  resolveEngagementFor: vi.fn(),
  setEngagement: vi.fn(),
}))

import { NotFoundError } from '@/lib/api/errors'
import { threadIsAwaitingHuman } from '@/lib/mentions/service'
import type { Message } from '@/lib/db/schema/messages'
import { emitInboxItems } from '@/lib/inbox/service'
import { resolveRequestsOnReply } from '@/lib/mentions/service'
import { countGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { resolveEngagement, resolveEngagementFor } from './engagement'
import { restrictingOtherProjects } from './cross-project-use'
import { lockedConversationIds, peopleWhoMayRead } from './restricted-use'
import { findConversationInOrg, findConversationRead, findMessageInConversation, insertMessages, mergeMessageMetadata } from './repository'
import { updateMessageDetail } from './service'
import { recordAgentStageFrame } from './agent-stage-frame'
import { mergeMetadataEntries } from './metadata-merge'
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

describe('a stage writes its output onto the message row (post-answer-stages §4.3)', () => {
  const MESSAGE_ID = '9c2a4c5e-7a1f-4a25-b0a2-2f3f7d0d5b21'
  const stages = { followUps: { items: [{ question: 'Und bei Hanglage?' }] } }

  beforeEach(() => {
    vi.mocked(mergeMessageMetadata).mockResolvedValue({ id: MESSAGE_ID } as never)
  })

  it('refuses a viewer — recording a stage is contributing, not reading', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })
    vi.mocked(findGrantForSubject).mockResolvedValue({ role: 'viewer' } as never)

    await expect(
      updateMessageDetail(session, CONVERSATION_ID, MESSAGE_ID, { stages })
    ).rejects.toThrow(NotFoundError)
    expect(mergeMessageMetadata).not.toHaveBeenCalled()
  })

  it('deep-merges by STAGE key, so two stages on one turn do not erase each other', async () => {
    stubConversation({ createdBy: 'user_me' })

    await updateMessageDetail(session, CONVERSATION_ID, MESSAGE_ID, { stages })

    expect(mergeMessageMetadata).toHaveBeenCalledWith(CONVERSATION_ID, MESSAGE_ID, { stages }, [
      'stages',
    ])
  })

  it('bounds what the client sent before it reaches the column', async () => {
    stubConversation({ createdBy: 'user_me' })

    await updateMessageDetail(session, CONVERSATION_ID, MESSAGE_ID, {
      stages: {
        followUps: {
          items: [{ question: 'x'.repeat(2000) }, ...Array(9).fill({ question: 'Noch?' })],
        },
        aStageFromTheFuture: { anything: 'unbounded' },
      },
    })

    const [, , metadata] = vi.mocked(mergeMessageMetadata).mock.calls[0]
    const stored = (metadata as { stages: { followUps: { items: { question: string }[] } } }).stages
    expect(Object.keys(stored)).toEqual(['followUps'])
    expect(stored.followUps.items).toHaveLength(4)
    expect(stored.followUps.items[0].question).toHaveLength(300)
  })

  it('writes nothing at all when nothing survives sanitisation', async () => {
    stubConversation({ createdBy: 'user_me' })
    vi.mocked(findMessageInConversation).mockResolvedValue({ id: MESSAGE_ID } as never)

    await updateMessageDetail(session, CONVERSATION_ID, MESSAGE_ID, {
      stages: { aStageFromTheFuture: { items: [] } },
    })

    expect(mergeMessageMetadata).not.toHaveBeenCalled()
  })
})

describe('the memory frame written by the browser and by the agent tier converges', () => {
  const MESSAGE_ID = '9c2a4c5e-7a1f-4a25-b0a2-2f3f7d0d5b21'
  const frame = {
    items: [
      { id: 'mem-1', kind: 'decision', content: 'Fassade in Lärche.', provenance: 'agent' },
      { id: 'mem-2', kind: 'constraint', content: 'Traufhöhe max. 9 m.' },
    ],
  }
  let row: { id: string; role: string; metadata: Record<string, unknown> }

  beforeEach(() => {
    stubConversation({ createdBy: 'user_me' })
    row = {
      id: MESSAGE_ID,
      role: 'assistant',
      metadata: { provenance: { confidence: 'high' }, stages: { followUps: { items: [{ question: 'Und die Dachform?' }] } } },
    }
    vi.mocked(findMessageInConversation).mockImplementation(async () => row as never)
    vi.mocked(mergeMessageMetadata).mockImplementation(async (_conversation, _message, patch, deepMergeKeys) => {
      const entries = typeof patch === 'function' ? patch(row.metadata) : patch
      if (entries) row = { ...row, metadata: mergeMetadataEntries(row.metadata, entries, deepMergeKeys) }
      return row as never
    })
  })

  const viaBrowser = () => updateMessageDetail(session, CONVERSATION_ID, MESSAGE_ID, { stages: { memoryReflection: frame } })
  const viaAgent = () =>
    recordAgentStageFrame('org_1', CONVERSATION_ID, MESSAGE_ID, { stage: 'memory_reflection', payload: frame })

  it('stores the same metadata whichever writer lands first, and a repeat changes nothing', async () => {
    await viaAgent()
    await viaBrowser()
    await viaAgent()
    const agentFirst = row.metadata

    row = { ...row, metadata: { provenance: { confidence: 'high' }, stages: { followUps: { items: [{ question: 'Und die Dachform?' }] } } } }
    await viaBrowser()
    await viaAgent()

    expect(row.metadata).toEqual(agentFirst)
    const stages = row.metadata.stages as { memoryReflection: { items: { id: string }[] }; followUps: unknown }
    expect(stages.memoryReflection.items.map((item) => item.id)).toEqual(['mem-1', 'mem-2'])
    expect(stages.followUps).toEqual({ items: [{ question: 'Und die Dachform?' }] })
    expect(row.metadata.provenance).toEqual({ confidence: 'high' })
  })

  it('refuses a conversation outside the organization, a missing answer and a message that is no answer', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValueOnce(null)
    await expect(viaAgent()).rejects.toThrow(NotFoundError)

    vi.mocked(findMessageInConversation).mockResolvedValueOnce(null)
    await expect(viaAgent()).rejects.toThrow(NotFoundError)

    vi.mocked(findMessageInConversation).mockResolvedValueOnce({ ...row, role: 'user' } as never)
    await expect(viaAgent()).rejects.toThrow(NotFoundError)
    expect(mergeMessageMetadata).not.toHaveBeenCalled()
  })

  it('stores nothing from a payload the sanitiser empties', async () => {
    await expect(
      recordAgentStageFrame('org_1', CONVERSATION_ID, MESSAGE_ID, {
        stage: 'memory_reflection',
        payload: { items: [{ id: 'x', kind: 'not-a-kind', content: 'y' }] },
      })
    ).rejects.toThrow('Nothing in the stage payload can be stored')
    expect(mergeMessageMetadata).not.toHaveBeenCalled()
  })
})
