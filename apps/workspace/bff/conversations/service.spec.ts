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
import { requireProjectAccess } from '@/lib/authz/projects'
import { threadIsAwaitingHuman } from '@/lib/mentions/service'
import type { Message } from '@/lib/db/schema/messages'
import { emitInboxItems } from '@/lib/inbox/service'
import { resolveRequestsOnReply } from '@/lib/mentions/service'
import { countGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { resolveEngagement, resolveEngagementFor } from './engagement'
import { restrictingOtherProjects } from './cross-project-use'
import { lockedConversationIds, peopleWhoMayRead } from './restricted-use'
import { deleteConversationInOrg, findConversationInOrg, findConversationRead, findConversationTenancy, findMessageInConversation, insertConversation, insertMessages, listMessagePage, listVisibleConversations, updateConversationTitleInOrg } from './repository'
import { createConversation, createConversationMessages, deleteConversation, getConversation, listConversationMessages, listConversations, updateConversationTitle } from './service'
import { CONVERSATION_ID, PROJECT_ID, session, stubConversation, stubContainer } from './service.fixtures'

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

describe('reading a conversation — the access rules', () => {
  it('404s a conversation in ANOTHER organization (tenancy is checked first)', async () => {
    stubConversation({ organizationId: 'org_2' })

    await expect(getConversation(session, CONVERSATION_ID)).rejects.toThrow(NotFoundError)
    expect(requireProjectAccess).not.toHaveBeenCalled()
  })

  it("404s someone else's PRIVATE conversation in the same org and project", async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })

    await expect(getConversation(session, CONVERSATION_ID)).rejects.toThrow(NotFoundError)
    await expect(listConversationMessages(session, CONVERSATION_ID)).rejects.toThrow(NotFoundError)
    expect(listMessagePage).not.toHaveBeenCalled()
  })

  it('lets another project member read a PROJECT-visible conversation', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_other' })

    const conversation = await getConversation(session, CONVERSATION_ID)

    expect(conversation.id).toBe(CONVERSATION_ID)
    expect(conversation.myRole).toBe('collaborator')
    expect(conversation.visibility).toBe('project')
    expect(conversation.shared).toBe(true)
  })

  it('lets a grantee read a PRIVATE conversation they were invited to', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })
    vi.mocked(findGrantForSubject).mockResolvedValue({ role: 'viewer' } as never)
    vi.mocked(countGrantsForResource).mockResolvedValue(1)

    const conversation = await getConversation(session, CONVERSATION_ID)

    expect(conversation.myRole).toBe('viewer')
    expect(conversation.shared).toBe(true)
  })

  it('404s when the caller lost access to the container project', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_me' })
    stubContainer('denied')

    await expect(getConversation(session, CONVERSATION_ID)).rejects.toThrow(NotFoundError)
  })

  it('reports a solo thread as NOT shared, so it keeps the local-first path', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_me' })

    const conversation = await getConversation(session, CONVERSATION_ID)

    expect(conversation.myRole).toBe('owner')
    expect(conversation.shared).toBe(false)
  })
})

describe('listing conversations', () => {
  beforeEach(() => {
    vi.mocked(listVisibleConversations).mockResolvedValue([])
  })

  it('passes the CALLER, not just the org, so the SQL can filter by visibility', async () => {
    await listConversations(session, { projectId: PROJECT_ID })

    expect(requireProjectAccess).toHaveBeenCalledWith(session, PROJECT_ID, 'project:view')
    expect(listVisibleConversations).toHaveBeenCalledWith('org_1', 'user_me', {
      projectId: PROJECT_ID,
      limit: 201,
      after: undefined,
    })
  })

  it('never reaches the repository for a project the caller cannot see', async () => {
    stubContainer('denied')

    await expect(listConversations(session, { projectId: PROJECT_ID })).rejects.toThrow(
      NotFoundError
    )
    expect(listVisibleConversations).not.toHaveBeenCalled()
  })

  it('lists without a project scope, narrowed to the caller (spec MG-1)', async () => {
    await listConversations(session)

    expect(requireProjectAccess).not.toHaveBeenCalled()
    expect(listVisibleConversations).toHaveBeenCalledWith('org_1', 'user_me', {
      projectId: undefined,
      limit: 201,
      after: undefined,
    })
  })
})

describe('creating a temporary conversation (ADR-0180)', () => {
  it('writes the flag with the row, so the first turn already keeps nothing', async () => {
    vi.mocked(insertConversation).mockImplementation(async (values) => values as never)

    await createConversation(session, { id: CONVERSATION_ID, temporary: true })

    expect(insertConversation).toHaveBeenCalledWith(expect.objectContaining({ id: CONVERSATION_ID, temporary: true }))
  })

  it('creates a conversation that keeps memory unless the caller says otherwise', async () => {
    vi.mocked(insertConversation).mockImplementation(async (values) => values as never)

    await createConversation(session, { id: CONVERSATION_ID })

    expect(insertConversation).toHaveBeenCalledWith(expect.objectContaining({ temporary: false }))
  })
})

describe('creating a conversation on an id that already exists', () => {
  beforeEach(() => {
    vi.mocked(insertConversation).mockResolvedValue(null) // id conflict
  })

  it('is idempotent for a participant of the existing thread', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_other' })

    const conversation = await createConversation(session, { id: CONVERSATION_ID })

    expect(conversation.id).toBe(CONVERSATION_ID)
  })

  it('never hands back a thread the caller cannot contribute to', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })

    await expect(createConversation(session, { id: CONVERSATION_ID })).rejects.toThrow(
      NotFoundError
    )
    expect(findConversationInOrg).not.toHaveBeenCalled()
  })
})

describe('writing requires more than reading', () => {
  it('lets a viewer read but not rename (rename is an owner call)', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })
    vi.mocked(findGrantForSubject).mockResolvedValue({ role: 'viewer' } as never)

    await expect(getConversation(session, CONVERSATION_ID)).resolves.toBeDefined()
    await expect(updateConversationTitle(session, CONVERSATION_ID, 'Neu')).rejects.toThrow(
      NotFoundError
    )
    expect(updateConversationTitleInOrg).not.toHaveBeenCalled()
  })

  it('refuses to append messages as a viewer (collaborator is the minimum)', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_other' })
    vi.mocked(findGrantForSubject).mockResolvedValue({ role: 'viewer' } as never)

    await expect(
      createConversationMessages(session, CONVERSATION_ID, [
        { id: 'msg_1', role: 'user', content: 'hi' },
      ])
    ).rejects.toThrow(NotFoundError)
    expect(insertMessages).not.toHaveBeenCalled()
  })

  it('refuses to delete a conversation the caller does not own', async () => {
    stubConversation({ visibility: 'project', createdBy: 'user_other' })

    await expect(deleteConversation(session, CONVERSATION_ID)).rejects.toThrow(NotFoundError)
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })

  it('answers the SAME refusal for an id that does not exist at all (spec SH-6)', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue(null)

    await expect(deleteConversation(session, CONVERSATION_ID)).rejects.toThrow(NotFoundError)
    expect(deleteConversationInOrg).not.toHaveBeenCalled()
  })
})
