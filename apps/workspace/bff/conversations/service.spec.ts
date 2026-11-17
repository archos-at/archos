/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn(),
}))

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

import { ConflictError, ForbiddenError, NotFoundError, ResourceRightsLostError, UpstreamError } from '@/lib/api/errors'
import { featureDisabledProblem } from '@/lib/authz/feature-disabled'
import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { purgeConversationCollaboration } from '@/lib/collaboration/cleanup'
import { isCoveredByActiveHold } from '@/lib/compliance/repository'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess, type ProjectRole } from '@/lib/authz/projects'
import { threadIsAwaitingHuman } from '@/lib/mentions/service'
import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import type { Message } from '@/lib/db/schema/messages'
import type { ResourceVisibility } from '@/lib/db/schema/resource-shares'
import { publishToUsers } from '@/lib/events/bus'
import { emitInboxItems, markResourceItemsReadFor } from '@/lib/inbox/service'
import { applyMessageMentions, resolveRequestsOnReply } from '@/lib/mentions/service'
import { countGrantsForResource, findGrantForSubject } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
import { deleteSessionCollection, purgeSessionDocuments } from '@/lib/session-documents/cleanup'
import { discardConversationDrafts } from './working-directory'
import { maskChatText } from '@/lib/upload-screening/service'
import { resolveEngagement, resolveEngagementFor, setEngagement } from './engagement'
import { restrictingOtherProjects } from './cross-project-use'
import { lockedConversationIds, peopleWhoMayRead } from './restricted-use'
import {
  deleteConversationInOrg,
  findConversationInOrg,
  findConversationRead,
  findConversationTenancy,
  findMessageInConversation,
  insertConversation,
  insertMessages,
  listMessagePage,
  listVisibleConversations,
  markConversationDeleting,
  mergeMessageMetadata,
  recordConversationErased,
  updateConversationMetaInOrg,
  updateConversationTitleInOrg,
  upsertConversationRead,
} from './repository'
import {
  createConversation,
  createConversationMessages,
  deleteConversation,
  generateConversationTitle,
  getConversation,
  listConversationMessages,
  listConversations,
  markConversationRead,
  persistInternalConversationMessages,
  retryConversationErasure,
  updateConversationTitle,
  updateMessageDetail,
} from './service'
import { PRODUCT_NAME } from '@/lib/brand'
import { recordAgentStageFrame } from './agent-stage-frame'
import { mergeMetadataEntries } from './metadata-merge'

const CONVERSATION_ID = 'conv_1'
const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const session = {
  userId: 'user_me',
  organizationId: 'org_1',
  role: 'member',
  roles: ['member'],
  permissions: [],
  email: 'me@example.test',
  featureFlags: ['collaboration'],
} as unknown as AuthorizedSession

function stubConversation(
  overrides: Partial<{
    organizationId: string
    projectId: string | null
    visibility: ResourceVisibility
    createdBy: string
    deletedAt: Date | null
  }> = {}
): void {
  const tenancy = {
    organizationId: 'org_1',
    projectId: PROJECT_ID,
    visibility: 'private' as ResourceVisibility,
    createdBy: 'user_creator',
    deletedAt: null,
    jobId: null,
    ...overrides,
  }
  vi.mocked(findConversationTenancy).mockResolvedValue(tenancy)
  vi.mocked(findConversationInOrg).mockResolvedValue({
    id: CONVERSATION_ID,
    title: 'Brandschutz Stiegenhaus',
    tags: [],
    engagement: null,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-02T10:00:00Z'),
    subjectResourceType: null,
    subjectResourceId: null,
    temporary: false,
    ...tenancy,
  })
}

function stubContainer(role: ProjectRole | 'denied'): void {
  if (role === 'denied') {
    vi.mocked(requireProjectAccess).mockRejectedValue(new NotFoundError())
    return
  }
  vi.mocked(requireProjectAccess).mockResolvedValue({ role } as never)
}

function messageRow(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_1',
    conversationId: CONVERSATION_ID,
    role: 'user',
    authorUserId: null,
    content: 'Ist das Atrium OIB 2.3?',
    metadata: {},
    createdAt: new Date('2026-07-02T10:00:00Z'),
    ...overrides,
  } as Message
}

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
