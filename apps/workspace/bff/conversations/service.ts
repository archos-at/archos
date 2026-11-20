import 'server-only'
import { requireProjectAccess } from '@/lib/authz/projects'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { ConversationRead } from '@/lib/db/schema/conversation-reads'
import type { Conversation, ConversationEngagement } from '@/lib/db/schema/conversations'
import type { Message } from '@/lib/db/schema/messages'
import type { ResourceRole, ResourceVisibility } from '@/lib/db/schema/resource-shares'
import { isShared, requireResourceAccess } from '@/lib/sharing/access'
import { countGrantsForResource } from '@/lib/sharing/repository'
import { resolvePeople } from '@/lib/sharing/directory'
import { resolveRequestsOnReply } from '@/lib/mentions/service'
import { isAgentMentionId } from '@/lib/mentions/types'
import { markResourceItemsReadFor } from '@/lib/inbox/service'
import { PRODUCT_NAME } from '@/lib/brand'
import { normalizeAgentAnswerMetadata } from './agent-answer-metadata'
import { recordPersistedAnswers } from './answer-records'
import {
  resolveEngagement,
  resolveEngagementFor,
  setEngagement,
  type EngagementState,
} from './engagement'
import { sanitizeProvenance } from './message-provenance'
import { answerMessageId, cutStoppedRow } from './stopped-cut'
import { sanitizeStages } from './message-stages'
import { restrictingOtherProjects, type RestrictingOtherProject } from './cross-project-use'
import { lockedConversationIds } from './restricted-use'
import {
  findConversationInOrg,
  findConversationRead,
  findConversationTenancy,
  findMessageInConversation,
  insertConversation,
  insertMessages,
  listMessagePage,
  listVisibleConversations,
  mergeMessageMetadata,
  reviseMessage,
  upsertConversationRead,
} from './repository'
import type { z } from 'zod'
import { CONVERSATION_PAGE_MAX, MESSAGE_PAGE_MAX, type createConversationSchema } from './conversation-wire'
import { parseMessageIncludes, toMessageView, type MessageListResponse } from './message-view'
import { fanOutMessageActivity } from './message-activity'
import { screenedInputs, screenedPromptState } from './message-screening'
import {
  NOBODY_ADDRESSED,
  buildMessageRow,
  prepareMessage,
  type CreateMessageInput,
  type PersistedMessage,
  type PreparedMessage,
} from './message-insert'

export { assertConversationAcceptsUploads, deleteConversation, retryConversationErasure } from './conversation-erasure'
export { generateConversationTitle, updateConversationTitle } from './conversation-title'
export type { ConversationTitleMessageInput, GenerateConversationTitleResult } from './conversation-title'
export type { CreateMessageInput, PersistedMessage } from './message-insert'

export type CreateConversationInput = z.infer<typeof createConversationSchema>

export interface ConversationWithAccess extends Conversation {
  shared: boolean
  myRole: ResourceRole | null
  visibility: ResourceVisibility
  myReadState: { lastReadAt: Date; lastReadMessageId: string | null } | null
  engagementMode: ConversationEngagement
  engagementStored: ConversationEngagement | null
  engagementSuggestion: ConversationEngagement | null
  restrictingOtherProjects: RestrictingOtherProject[]
}

export interface ListConversationsFilter {
  projectId?: string
  limit?: number
  cursor?: string
}

export interface ConversationListPage {
  conversations: ListedConversation[]
  nextCursor: string | null
}

export async function listConversations(
  session: AuthorizedSession,
  filter: ListConversationsFilter = {}
): Promise<ConversationListPage> {
  if (filter.projectId) {
    await requireProjectAccess(session, filter.projectId, 'project:view')
  }
  const pageSize = Math.min(Math.max(1, Math.trunc(filter.limit ?? CONVERSATION_PAGE_MAX)), CONVERSATION_PAGE_MAX)
  const fetched = await listVisibleConversations(session.organizationId, session.userId, {
    projectId: filter.projectId,
    limit: pageSize + 1,
    after: filter.cursor,
  })
  const hasMore = fetched.length > pageSize
  const rows = hasMore ? fetched.slice(0, pageSize) : fetched
  const locked = await lockedConversationIds(
    session,
    rows.map((row) => ({ id: row.id, projectId: row.projectId }))
  )
  return {
    conversations: rows.map((row) => (locked.has(row.id) ? withheldConversation(row) : { ...row, contentLocked: false })),
    nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
  }
}

export type ListedConversation = Conversation & { contentLocked: boolean }

function withheldConversation(row: Conversation): ListedConversation {
  return { ...row, title: null, tags: [], subjectResourceType: null, subjectResourceId: null, contentLocked: true }
}

export async function getConversation(
  session: AuthorizedSession,
  conversationId: string
): Promise<ConversationWithAccess> {
  const access = await requireResourceAccess(session, 'conversation', conversationId, 'viewer')

  const [conversation, grantCount, readMark, restricting] = await Promise.all([
    findConversationInOrg(conversationId, session.organizationId),
    countGrantsForResource('conversation', conversationId),
    findConversationRead(conversationId, session.userId),
    restrictingOtherProjects(conversationId, session.organizationId),
  ])
  if (!conversation) throw new NotFoundError()

  const shared = isShared(access.visibility, grantCount)
  const engagement = shared
    ? await resolveEngagement(conversationId, session.organizationId, conversation.engagement, {
        withSuggestion: true,
      })
    : { mode: 'ask' as const, stored: conversation.engagement, suggestion: null }

  return {
    ...conversation,
    shared,
    myRole: access.role,
    visibility: access.visibility,
    myReadState: readMark
      ? { lastReadAt: readMark.lastReadAt, lastReadMessageId: readMark.lastReadMessageId }
      : null,
    engagementMode: engagement.mode,
    engagementStored: engagement.stored,
    engagementSuggestion: engagement.suggestion,
    restrictingOtherProjects: restricting,
  }
}

export async function updateConversationEngagement(
  session: AuthorizedSession,
  conversationId: string,
  mode: ConversationEngagement
): Promise<ConversationWithAccess> {
  await requireResourceAccess(session, 'conversation', conversationId, 'collaborator')
  await setEngagement(conversationId, session.organizationId, mode)
  return getConversation(session, conversationId)
}

export async function createConversation(
  session: AuthorizedSession,
  input: CreateConversationInput
): Promise<Conversation> {
  if (input.projectId) {
    await requireProjectAccess(session, input.projectId, CHAT_PERMISSIONS)
  }

  const inserted = await insertConversation({
    id: input.id,
    organizationId: session.organizationId,
    createdBy: session.userId,
    title: input.title ?? null,
    projectId: input.projectId ?? null,
    subjectResourceType: input.subjectResourceType ?? null,
    subjectResourceId: input.subjectResourceId ?? null,
    temporary: input.temporary ?? false,
  })
  if (inserted) return inserted

  await requireResourceAccess(session, 'conversation', input.id, 'collaborator')
  const existing = await findConversationInOrg(input.id, session.organizationId)
  if (!existing) throw new NotFoundError()
  return existing
}

export async function listConversationMessages(
  session: AuthorizedSession,
  conversationId: string,
  query: { limit?: number; cursor?: string; include?: string } = {}
): Promise<MessageListResponse> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')

  const limit = Math.min(Math.max(1, Math.trunc(query.limit ?? 50)), MESSAGE_PAGE_MAX)
  const [page, tenancy] = await Promise.all([
    listMessagePage(conversationId, { limit, before: query.cursor }),
    findConversationTenancy(conversationId),
  ])
  const rows = page.rows.map((row) => attributeLegacyAuthor(row, tenancy?.createdBy ?? null))
  const authorIds = [...new Set(rows.flatMap((row) => (row.authorUserId ? [row.authorUserId] : [])))]
  const people = await resolvePeople(session.organizationId, authorIds)
  const names = new Map([...people].map(([userId, person]) => [userId, person.name]))
  const include = parseMessageIncludes(query.include)
  return {
    messages: rows.map((row) => toMessageView(row, names, include)),
    nextCursor: page.hasMore ? (rows[0]?.id ?? null) : null,
  }
}

function attributeLegacyAuthor(row: Message, createdBy: string | null): Message {
  if (row.role !== 'user' || row.authorUserId || !createdBy) return row
  return { ...row, authorUserId: createdBy }
}

export async function updateMessageDetail(
  session: AuthorizedSession,
  conversationId: string,
  messageId: string,
  patch: {
    cardInteractions?: Record<string, unknown>
    provenance?: unknown
    promptState?: unknown
    stages?: unknown
  }
): Promise<Message> {
  await requireResourceAccess(session, 'conversation', conversationId, 'collaborator')

  const metadata: Record<string, unknown> = {}
  const deepMergeKeys: string[] = []

  if (patch.cardInteractions) {
    metadata.cardInteractions = patch.cardInteractions
    deepMergeKeys.push('cardInteractions')
  }

  if (patch.provenance !== undefined) {
    const provenance = sanitizeProvenance(patch.provenance)
    if (provenance) metadata.provenance = provenance
  }

  if (patch.promptState !== undefined) {
    const promptState = await screenedPromptState(session.organizationId, patch.promptState)
    if (promptState) metadata.promptState = promptState
  }

  if (patch.stages !== undefined) {
    const stages = sanitizeStages(patch.stages)
    if (stages) {
      metadata.stages = stages
      deepMergeKeys.push('stages')
    }
  }

  if (Object.keys(metadata).length === 0) {
    const existing = await findMessageInConversation(conversationId, messageId)
    if (!existing) throw new NotFoundError()
    return existing
  }

  const row = await mergeMessageMetadata(conversationId, messageId, metadata, deepMergeKeys)
  if (!row) throw new NotFoundError()
  return row
}

export async function cutStoppedAnswer(
  session: AuthorizedSession,
  conversationId: string,
  messageId: string,
  input: { turnId: string; shown: string }
): Promise<Message> {
  await requireResourceAccess(session, 'conversation', conversationId, 'collaborator')
  if (answerMessageId(conversationId, input.turnId) !== messageId) throw new NotFoundError()
  const question = await findMessageInConversation(conversationId, input.turnId)
  if (!question || question.role !== 'user') throw new NotFoundError()
  if (question.authorUserId !== session.userId) {
    throw new ForbiddenError('Only the person who asked can stop this answer.')
  }
  const now = Date.now()
  const row = await reviseMessage(conversationId, messageId, (existing) => cutStoppedRow(existing, input.shown, now))
  if (!row) throw new NotFoundError()
  return row
}

export async function createConversationMessages(
  session: AuthorizedSession,
  conversationId: string,
  unscreened: CreateMessageInput[]
): Promise<PersistedMessage[]> {
  const access = await requireResourceAccess(
    session,
    'conversation',
    conversationId,
    'collaborator'
  )
  const inputs = await screenedInputs(session.organizationId, unscreened)

  const grantCount = await countGrantsForResource('conversation', conversationId)
  const shared = isShared(access.visibility, grantCount)

  let engagementState: EngagementState | null = null
  const engagement = async (): Promise<EngagementState> =>
    (engagementState ??= await resolveEngagementFor(conversationId, session.organizationId))

  const assertMayRunAgent = async (): Promise<void> => {
    if (!access.container.projectId) return
    try {
      await requireProjectAccess(session, access.container.projectId, CHAT_PERMISSIONS)
    } catch {
      throw new ForbiddenError(
        'You do not have permission to ask ' + PRODUCT_NAME + ' in this project.'
      )
    }
  }

  const mentionsAgent = inputs.some(
    (input) =>
      input.role === 'user' &&
      (input.mentions ?? []).some((mention) => isAgentMentionId(mention.targetId))
  )
  if (mentionsAgent) await assertMayRunAgent()

  const prepared: PreparedMessage[] = []
  for (const input of inputs) {
    prepared.push(await prepareMessage(session, conversationId, input, { shared, engagement }))
  }

  const addressesAgent = prepared.some((entry) => entry.addressees?.agent === true)
  if (addressesAgent) await assertMayRunAgent()

  const rows = await insertMessages(
    prepared.map((entry) => buildMessageRow(conversationId, entry, session.userId))
  )

  const rulingById = new Map(prepared.map((entry) => [entry.input.id, entry]))
  const persisted: PersistedMessage[] = rows.map((row) => {
    const entry = rulingById.get(row.id)
    return {
      ...row,
      addressees: entry?.addressees ?? NOBODY_ADDRESSED,
      createdRequests: entry?.createdRequests ?? 0,
    }
  })

  const humanMessages = persisted.filter((message) => message.role === 'user')

  if (humanMessages.length > 0) {
    try {
      await resolveRequestsOnReply({
        organizationId: session.organizationId,
        resourceType: 'conversation',
        resourceId: conversationId,
        authorUserId: session.userId,
        addressedUserIds: [
          ...new Set(humanMessages.flatMap((message) => message.addressees.users)),
        ],
      })
    } catch (error) {
      console.warn('[conversations] resolving mention requests on reply failed (non-fatal):', error)
    }
  }

  await fanOutMessageActivity({
    shared,
    organizationId: session.organizationId,
    conversationId,
    visibility: access.visibility,
    actorUserId: session.userId,
    rows: persisted,
    turnStartedFor: humanMessages
      .filter((message) => message.addressees.agent)
      .map((message) => message.id),
    emitAmbient: true,
  })

  return persisted
}

export async function markConversationRead(
  session: AuthorizedSession,
  conversationId: string,
  input: { lastReadMessageId?: string | null } = {}
): Promise<ConversationRead> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')

  const mark = await upsertConversationRead({
    conversationId,
    userId: session.userId,
    lastReadMessageId: input.lastReadMessageId ?? undefined,
  })

  if (isCollaborationEnabled(session)) {
    try {
      await markResourceItemsReadFor(session, 'conversation', conversationId)
    } catch (error) {
      console.warn('[conversations] clearing ambient inbox items failed (non-fatal):', error)
    }
  }

  return mark
}

export async function persistInternalConversationMessages(
  organizationId: string,
  conversationId: string,
  inputs: CreateMessageInput[]
): Promise<Message[]> {
  const conversation = await findConversationInOrg(conversationId, organizationId)
  if (!conversation) throw new NotFoundError()
  const screened = await screenedInputs(organizationId, inputs)

  const rows = await insertMessages(
    screened.map((input) =>
      buildMessageRow(
        conversationId,
        {
          input: { ...input, metadata: normalizeAgentAnswerMetadata(input.metadata) },
          addressees: null,
          createdRequests: 0,
        },
        null
      )
    )
  )

  await recordPersistedAnswers(organizationId, conversation.projectId ?? null, conversationId, inputs, rows)
  await fanOutMessageActivity({
    organizationId,
    conversationId,
    visibility: conversation.visibility,
    actorUserId: null,
    rows,
    turnStartedFor: [],
    emitAmbient: false,
    title: conversation.title,
  })

  return rows
}
