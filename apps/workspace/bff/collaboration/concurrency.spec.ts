/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))

vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/events/bus', () => ({
  publishToUser: vi.fn().mockResolvedValue(undefined),
  publishToUsers: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))

vi.mock('@/lib/authz/project-membership', () => ({
  canUserAccessProject: vi.fn(),
  filterUsersWithProjectAccess: vi.fn(),
}))

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn(),
}))

vi.mock('@/lib/conversations/restricted-use', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/restricted-use')>()),
  peopleWhoMayRead: vi.fn(async (_org: string, _id: string, userIds: readonly string[]) => new Set(userIds)),
  lockedConversationIds: vi.fn(async () => new Set<string>()),
}))

vi.mock('@/lib/conversations/repository', () => ({
  deleteConversationInOrg: vi.fn(),
  findConversationInOrg: vi.fn(),
  findConversationRead: vi.fn(),
  findConversationTenancy: vi.fn(),
  findMessageInConversation: vi.fn(),
  insertConversation: vi.fn(),
  insertMessages: vi.fn(),
  listConversationIdsForProject: vi.fn(),
  listMessagesForConversation: vi.fn(),
  listVisibleConversations: vi.fn(),
  mergeMessageMetadata: vi.fn(),
  updateConversationMetaInOrg: vi.fn(),
  updateConversationTitleInOrg: vi.fn(),
  updateConversationVisibilityInOrg: vi.fn(),
  upsertConversationRead: vi.fn(),
}))

vi.mock('@/lib/sharing/repository', () => ({
  SHARE_ROSTER_LIMIT: 200,
  countGrantsForResource: vi.fn(),
  deleteAllGrantsForResource: vi.fn(),
  deleteGrant: vi.fn(),
  findGrantForSubject: vi.fn(),
  listGrantsForResource: vi.fn(),
  upsertGrant: vi.fn(),
}))

vi.mock('@/lib/mentions/repository', () => ({
  findRequestById: vi.fn(),
  insertMentionRequests: vi.fn(),
  listOpenRequestsForResource: vi.fn(),
  listOpenRequestsForSubject: vi.fn(),
  resolveRequests: vi.fn(),
  voidOpenRequestsForResource: vi.fn(),
  voidOpenRequestsForSubject: vi.fn(),
}))

vi.mock('@/lib/inbox/repository', () => ({
  INBOX_LIST_LIMIT: 50,
  archiveInboxItem: vi.fn(),
  countPendingInboxItems: vi.fn(),
  listInboxItems: vi.fn(),
  countInboxFilters: vi.fn(async () => ({ requests: 0, unread: 0 })),
  markAnchorItemsRead: vi.fn(),
  markInboxItemsUnread: vi.fn(),
  unarchiveInboxItem: vi.fn(),
  markAllInboxItemsRead: vi.fn(),
  markInboxItemsRead: vi.fn(),
  markItemsInertForResource: vi.fn(),
  markItemsInertForSubjectRow: vi.fn(),
  markResourceItemsRead: vi.fn(),
  resolveInboxItemsForTargets: vi.fn(),
  upsertInboxItems: vi.fn(),
}))

vi.mock('@/lib/sharing/directory', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/sharing/directory')>()),
  loadOrganizationDirectory: vi.fn(),
}))

vi.mock('@/lib/limits', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/limits')>()),
  consumeLimit: vi.fn(),
}))

import { drizzle as proxyDrizzle } from 'drizzle-orm/pg-proxy'
import { NotFoundError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess, type ProjectRole } from '@/lib/authz/projects'
import {
  findConversationInOrg,
  findConversationTenancy,
  findMessageInConversation,
  insertMessages,
} from '@/lib/conversations/repository'
import { createConversationMessages } from '@/lib/conversations/service'
import { getDb } from '@/lib/db'
import type { NewInboxItem } from '@/lib/db/schema/inbox'
import type { MentionRequest } from '@/lib/db/schema/mention-requests'
import type { Message } from '@/lib/db/schema/messages'
import type { ResourceRole, ResourceVisibility } from '@/lib/db/schema/resource-shares'
import { publishToUser, publishToUsers } from '@/lib/events/bus'
import { emitInboxItems } from '@/lib/inbox/service'
import { inboxGroupKey } from '@/lib/inbox/registry'
import {
  countPendingInboxItems,
  resolveInboxItemsForTargets,
  upsertInboxItems,
} from '@/lib/inbox/repository'
import {
  findRequestById,
  insertMentionRequests,
  listOpenRequestsForResource,
  listOpenRequestsForSubject,
  resolveRequests,
} from '@/lib/mentions/repository'
import { releaseRequest, resolveRequestsOnReply } from '@/lib/mentions/service'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import {
  countGrantsForResource,
  deleteGrant,
  findGrantForSubject,
  listGrantsForResource,
} from '@/lib/sharing/repository'
import { revokeResourceAccess } from '@/lib/sharing/service'

const CONVERSATION_ID = 'conv_1'
const ANNA = 'user_anna'

const session = {
  userId: 'user_me',
  organizationId: 'org_1',
  email: 'me@example.test',
  role: 'member',
  roles: ['member'],
  permissions: [],
  featureFlags: ['collaboration'],
} as unknown as AuthorizedSession

const annaSession = { ...session, userId: ANNA } as unknown as AuthorizedSession

function stubConversation(
  overrides: Partial<{
    organizationId: string
    projectId: string | null
    visibility: ResourceVisibility
    createdBy: string | null
    deletedAt: Date | null
  }> = {},
): void {
  const tenancy = {
    organizationId: 'org_1',
    projectId: 'proj_1',
    visibility: 'project' as ResourceVisibility,
    createdBy: session.userId,
    deletedAt: null,
    ...overrides,
  }
  vi.mocked(findConversationTenancy).mockResolvedValue(tenancy as never)
  vi.mocked(findConversationInOrg).mockResolvedValue({
    id: CONVERSATION_ID,
    title: 'Brandschutz Halle 3',
    tags: [],
    ...tenancy,
  } as never)
}

function stubContainer(role: ProjectRole | 'denied'): void {
  if (role === 'denied') {
    vi.mocked(requireProjectAccess).mockRejectedValue(new NotFoundError())
    return
  }
  vi.mocked(requireProjectAccess).mockResolvedValue({ role } as never)
}

function stubMyGrant(role: ResourceRole | null): void {
  vi.mocked(findGrantForSubject).mockResolvedValue(role ? ({ role } as never) : null)
}

function requestRow(overrides: Partial<MentionRequest> = {}): MentionRequest {
  return {
    id: 'req_1',
    organizationId: 'org_1',
    resourceType: 'conversation',
    resourceId: CONVERSATION_ID,
    anchorId: 'msg_1',
    requestedBy: session.userId,
    requestedOf: ANNA,
    note: 'Atrium als OIB 2.3?',
    status: 'open',
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date('2026-07-29T10:00:00.000Z'),
    ...overrides,
  }
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

interface CapturedQuery {
  sql: string
  params: unknown[]
}

function captureSql(rows: unknown[][] = []): CapturedQuery[] {
  const queries: CapturedQuery[] = []
  const db = proxyDrizzle(async (sql: string, params: unknown[]) => {
    queries.push({ sql, params })
    return { rows }
  })
  vi.mocked(getDb).mockReturnValue(db as never)
  return queries
}

beforeEach(() => {
  vi.stubEnv('REQUIRE_AUTH', 'true')
  stubConversation()
  stubContainer('project-editor')
  stubMyGrant(null)
  vi.mocked(listGrantsForResource).mockResolvedValue([])
  vi.mocked(countGrantsForResource).mockResolvedValue(0)
  vi.mocked(countPendingInboxItems).mockResolvedValue(0)
  vi.mocked(loadOrganizationDirectory).mockResolvedValue(new Map())
  vi.mocked(listOpenRequestsForResource).mockResolvedValue([])
  vi.mocked(listOpenRequestsForSubject).mockResolvedValue([])
  vi.mocked(resolveRequests).mockResolvedValue([])
  vi.mocked(resolveInboxItemsForTargets).mockResolvedValue(0)
  vi.mocked(upsertInboxItems).mockImplementation(async (rows) => rows as never)
  vi.mocked(insertMentionRequests).mockResolvedValue([])
  vi.mocked(insertMessages).mockImplementation(async (rows) => rows as Message[])
  vi.mocked(findMessageInConversation).mockResolvedValue(null)
  vi.mocked(deleteGrant).mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('two people answering the same mention (matrix D21, spec CC-15)', () => {
  it('transitions only rows that are still open, so a late close cannot rewrite a resolution', async () => {
    const queries = captureSql()
    const mentions = await vi.importActual<typeof import('@/lib/mentions/repository')>(
      '@/lib/mentions/repository',
    )

    await mentions.resolveRequests(['req_1'], 'answered', ANNA)

    expect(queries).toHaveLength(1)
    expect(queries[0]!.sql).toContain('"mention_requests"."status" = ')
    expect(queries[0]!.params).toContain('open')
    expect(queries[0]!.sql).toMatch(/^update "mention_requests" set "status" = /)
  })

  it('makes the losing answer a no-op rather than a second notification', async () => {
    vi.mocked(listOpenRequestsForSubject).mockResolvedValue([requestRow()])
    vi.mocked(resolveRequests).mockResolvedValue([])

    const result = await resolveRequestsOnReply({
      organizationId: 'org_1',
      resourceType: 'conversation',
      resourceId: CONVERSATION_ID,
      authorUserId: ANNA,
    })

    expect(result).toEqual({ answered: 0, askedBack: 0, askerUserIds: [] })
    expect(upsertInboxItems).not.toHaveBeenCalled()
    expect(resolveInboxItemsForTargets).not.toHaveBeenCalled()
    expect(publishToUsers).not.toHaveBeenCalled()
  })

  it('lets the FIRST answer close the request and notify the asker exactly once', async () => {
    vi.mocked(listOpenRequestsForSubject).mockResolvedValue([requestRow()])
    vi.mocked(resolveRequests).mockResolvedValue([
      requestRow({ status: 'answered', resolution: 'answered', resolvedBy: ANNA }),
    ])

    const result = await resolveRequestsOnReply({
      organizationId: 'org_1',
      resourceType: 'conversation',
      resourceId: CONVERSATION_ID,
      authorUserId: ANNA,
    })

    expect(result).toEqual({ answered: 1, askedBack: 0, askerUserIds: [session.userId] })
    expect(vi.mocked(upsertInboxItems).mock.calls[0]![0]).toHaveLength(1)
  })
})

describe('a replayed message id (matrix D22, spec MN-2)', () => {
  it('reads back the first ruling instead of minting a second mention request', async () => {
    vi.mocked(findMessageInConversation).mockResolvedValue(
      messageRow({ metadata: { addressees: { agent: false, users: [ANNA] } } }),
    )

    const [persisted] = await createConversationMessages(session, CONVERSATION_ID, [
      { id: 'msg_1', role: 'user', content: '@Anna richtig?', mentions: [{ targetId: ANNA }] },
    ])

    expect(persisted!.addressees).toEqual({ agent: false, users: [ANNA] })
    expect(persisted!.createdRequests).toBe(0)
    expect(insertMentionRequests).not.toHaveBeenCalled()
  })
})

describe('emitting the same notification twice (matrix D23, spec IB-8)', () => {
  const emission = {
    organizationId: 'org_1',
    recipientUserId: ANNA,
    type: 'mention.requested' as const,
    resourceType: 'conversation' as const,
    resourceId: CONVERSATION_ID,
    anchorId: 'msg_1',
    actorUserId: session.userId,
    groupKey: inboxGroupKey('mention.requested', 'conversation', CONVERSATION_ID, 'msg_1'),
    payload: { subject: 'Halle 3', excerpt: 'Atrium?' },
  }

  it('folds onto the same (recipient, group key) row both times', async () => {
    await emitInboxItems([emission])
    await emitInboxItems([emission])

    const [first] = vi.mocked(upsertInboxItems).mock.calls[0]![0] as NewInboxItem[]
    const [second] = vi.mocked(upsertInboxItems).mock.calls[1]![0] as NewInboxItem[]
    expect(second!.groupKey).toBe(first!.groupKey)
    expect(second!.recipientUserId).toBe(first!.recipientUserId)
  })

  it('increments a counted row rather than inserting a duplicate', async () => {
    const queries = captureSql([['item_1']])
    const inbox = await vi.importActual<typeof import('@/lib/inbox/repository')>('@/lib/inbox/repository')

    await inbox.upsertInboxItems([
      {
        organizationId: 'org_1',
        recipientUserId: ANNA,
        type: 'mention.requested',
        resourceType: 'conversation',
        resourceId: CONVERSATION_ID,
        groupKey: emission.groupKey,
        actionable: true,
        payload: {},
      },
    ])

    expect(queries).toHaveLength(1)
    expect(queries[0]!.sql).toContain('on conflict ("recipient_user_id","group_key") do update set')
    expect(queries[0]!.sql).toContain('"count" = "inbox_items"."count" + excluded.count')
    expect(queries[0]!.sql).toContain('"read_at" = ')
    expect(queries[0]!.sql).not.toContain('do nothing')
  })

  it('adds exactly one for a plain emission, and N for one emission standing for N occurrences', async () => {
    await emitInboxItems([emission])
    await emitInboxItems([{ ...emission, occurrences: 4 }])

    const [plain] = vi.mocked(upsertInboxItems).mock.calls[0]![0] as NewInboxItem[]
    const [folded] = vi.mocked(upsertInboxItems).mock.calls[1]![0] as NewInboxItem[]
    expect(plain!.count).toBe(1)
    expect(folded!.count).toBe(4)

    const queries = captureSql([['item_1']])
    const inbox = await vi.importActual<typeof import('@/lib/inbox/repository')>('@/lib/inbox/repository')
    await inbox.upsertInboxItems([{ ...folded!, payload: {} }])
    expect(queries[0]!.params).toContain(4)
  })

  it('drops the actor\'s own copy, so a re-emission cannot self-notify either', async () => {
    await emitInboxItems([{ ...emission, recipientUserId: session.userId }])

    expect(upsertInboxItems).not.toHaveBeenCalled()
    expect(publishToUser).not.toHaveBeenCalled()
  })
})

describe('releasing a request twice (matrix D24, spec MN-9.2)', () => {
  it('is a no-op the second time, not an error', async () => {
    vi.mocked(findRequestById).mockResolvedValue(
      requestRow({ status: 'released', resolution: 'released', resolvedBy: session.userId }),
    )

    const state = await releaseRequest(session, 'req_1')

    expect(state).toEqual({ pending: [], awaitingMe: false })
    expect(resolveInboxItemsForTargets).not.toHaveBeenCalled()
    expect(publishToUsers).not.toHaveBeenCalled()
  })

  it('still needs contributor access on the conversation before deciding that', async () => {
    vi.mocked(findRequestById).mockResolvedValue(requestRow({ status: 'released' }))
    stubConversation({ visibility: 'private', createdBy: 'user_other' })
    stubMyGrant('viewer')

    await expect(releaseRequest(annaSession, 'req_1')).rejects.toBeInstanceOf(NotFoundError)
    expect(resolveRequests).not.toHaveBeenCalled()
  })
})

describe('revoking a grant twice (matrix D25, spec SH-13)', () => {
  it('answers 404 for a grant that is already gone rather than pretending to succeed', async () => {
    stubConversation({ visibility: 'private', createdBy: 'user_creator' })
    stubMyGrant('owner')
    vi.mocked(deleteGrant).mockResolvedValue(false)

    await expect(
      revokeResourceAccess(session, 'conversation', CONVERSATION_ID, ANNA),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(recordAuditEvent).not.toHaveBeenCalled()
    expect(publishToUsers).not.toHaveBeenCalled()
    expect(resolveInboxItemsForTargets).not.toHaveBeenCalled()
  })
})
