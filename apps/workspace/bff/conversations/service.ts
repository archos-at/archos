import 'server-only'
import { requireProjectAccess } from '@/lib/authz/projects'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { FEATURE_FLAGS, isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { getBackendUrl } from '@/lib/backend-proxy'
import { ConflictError, ForbiddenError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { ConversationRead } from '@/lib/db/schema/conversation-reads'
import type { Conversation, ConversationEngagement } from '@/lib/db/schema/conversations'
import type { Message } from '@/lib/db/schema/messages'
import type { ResourceRole, ResourceVisibility } from '@/lib/db/schema/resource-shares'
import { purgeConversationCollaboration } from '@/lib/collaboration/cleanup'
import { discardConversationDrafts } from './working-directory'
import { deleteSessionCollection, purgeSessionDocuments } from '@/lib/session-documents/cleanup'
import { sessionCollectionName } from '@/lib/retrieval-scope/collection-scope'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { publishToUsers } from '@/lib/events/bus'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, markResourceItemsReadFor } from '@/lib/inbox/service'
import {
  applyMessageMentions,
  resolveRequestsOnReply,
  threadIsAwaitingHuman,
} from '@/lib/mentions/service'
import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import type { AddresseeSet, MentionInput, PersistedMessageResult } from '@/lib/mentions/types'
import { isShared, requireResourceAccess } from '@/lib/sharing/access'
import { countGrantsForResource } from '@/lib/sharing/repository'
import { resolveParticipants } from '@/lib/sharing/service'
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
import { sanitizePromptDetail, sanitizePromptState, type StoredPromptState } from './message-prompt'
import { maskAnswerText, maskChatText } from '@/lib/upload-screening/service'
import { restrictingOtherProjects, type RestrictingOtherProject } from './cross-project-use'
import { lockedConversationIds } from './restricted-use'
import { CONVERSATION_TAG_KEYS, normalizeConversationTags } from './tags'
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
  reviseMessage,
  updateConversationMetaInOrg,
  updateConversationTitleInOrg,
  upsertConversationRead,
} from './repository'
import type { z } from 'zod'
import { CONVERSATION_PAGE_MAX, MESSAGE_PAGE_MAX, type createConversationSchema } from './conversation-wire'
import { parseMessageIncludes, toMessageView, type MessageListResponse } from './message-view'
import { resolvePeople } from '@/lib/sharing/directory'
import { PRODUCT_NAME } from '@/lib/brand'

const GENERATE_TITLE_TIMEOUT_MS = 35_000

export interface ConversationTitleMessageInput {
  role: 'user' | 'assistant'
  content: string
}

export interface GenerateConversationTitleResult {
  title: string
  tags: string[]
  error?: string
}

export type CreateConversationInput = z.infer<typeof createConversationSchema>

export interface CreateMessageInput {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  messageType?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  mentions?: MentionInput[]
  mentionNote?: string | null
}

export interface PersistedMessage extends Message, PersistedMessageResult {}

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

export async function updateConversationTitle(
  session: AuthorizedSession,
  conversationId: string,
  title: string
): Promise<Conversation> {
  await requireResourceAccess(session, 'conversation', conversationId, 'owner')

  const conversation = await updateConversationTitleInOrg(
    conversationId,
    session.organizationId,
    title
  )
  if (!conversation) throw new NotFoundError()
  return conversation
}

export async function generateConversationTitle(
  session: AuthorizedSession,
  conversationId: string,
  input: { messages: ConversationTitleMessageInput[]; locale?: string }
): Promise<GenerateConversationTitleResult> {
  await requireResourceAccess(session, 'conversation', conversationId, 'owner')

  const messages = (
    await screenedInputs(
      session.organizationId,
      input.messages.map((m) => ({ role: m.role, content: (m.content ?? '').trim() })),
      { wholeText: true }
    )
  ).filter((m) => m.content.length > 0)
  if (messages.length === 0) {
    return { title: '', tags: [] }
  }

  let backendRes: Response
  try {
    backendRes = await fetch(`${getBackendUrl()}/v1/generate-conversation-title`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-organization-id': session.organizationId,
      },
      body: JSON.stringify({
        messages,
        allowed_tags: CONVERSATION_TAG_KEYS,
        locale: input.locale ?? 'de',
      }),
      signal: AbortSignal.timeout(GENERATE_TITLE_TIMEOUT_MS),
    })
  } catch (e) {
    console.warn('[GenerateConversationTitle] Backend unreachable (non-fatal):', e)
    return { title: '', tags: [], error: 'backend_unreachable' }
  }

  if (!backendRes.ok) {
    const errorText = await backendRes.text().catch(() => '')
    console.error('[GenerateConversationTitle] Backend error:', backendRes.status, errorText)
    return { title: '', tags: [], error: 'backend_error' }
  }

  const { title, tags, error } = (await backendRes.json()) as {
    title: string
    tags?: string[]
    error?: string | null
  }

  if (error) {
    console.warn('[GenerateConversationTitle] Generation failed (non-fatal):', error)
    return { title: '', tags: [], error }
  }

  const cleanTitle = (title ?? '').trim()
  const cleanTags = normalizeConversationTags(tags ?? [])

  if (cleanTitle) {
    await updateConversationMetaInOrg(conversationId, session.organizationId, {
      title: cleanTitle,
      tags: cleanTags,
    })
  }

  return { title: cleanTitle, tags: cleanTags }
}

async function authorizeConversationDelete(
  session: AuthorizedSession,
  conversationId: string
): Promise<void> {
  try {
    await requireResourceAccess(session, 'conversation', conversationId, 'owner', { allowLocked: true })
    return
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error

    const tenancy = await findConversationTenancy(conversationId)
    if (
      !tenancy?.deletedAt ||
      tenancy.organizationId !== session.organizationId ||
      tenancy.createdBy !== session.userId
    ) {
      throw error
    }
    if (tenancy.projectId) {
      await requireProjectAccess(session, tenancy.projectId, 'project:view')
    }
  }
}

export async function assertConversationAcceptsUploads(
  conversationId: string,
  organizationId: string
): Promise<void> {
  const tenancy = await findConversationTenancy(conversationId)
  if (!tenancy || tenancy.organizationId !== organizationId) throw new NotFoundError()
  if (tenancy.deletedAt) {
    throw new ConflictError('This chat is being deleted; no further files can be attached to it.')
  }
}

export async function deleteConversation(
  session: AuthorizedSession,
  conversationId: string
): Promise<void> {
  await authorizeConversationDelete(session, conversationId)

  await assertNoActiveHold(session.organizationId, 'conversation', conversationId)

  const marked = await markConversationDeleting(conversationId, session.organizationId, session.userId)
  if (!marked) throw new NotFoundError()

  await eraseMarkedConversation(session.organizationId, conversationId)
}

export async function retryConversationErasure(
  organizationId: string,
  conversationId: string
): Promise<{ outcome: 'erased' | 'already-gone' }> {
  await assertNoActiveHold(organizationId, 'conversation', conversationId)
  const tenancy = await findConversationTenancy(conversationId)
  if (tenancy && tenancy.organizationId !== organizationId) throw new NotFoundError()
  if (tenancy && !tenancy.deletedAt) {
    throw new ConflictError('This chat is not being deleted.', { reason: 'not_deleting' })
  }
  await eraseMarkedConversation(organizationId, conversationId)
  return { outcome: tenancy ? 'erased' : 'already-gone' }
}

async function eraseMarkedConversation(organizationId: string, conversationId: string): Promise<void> {
  const purge = await purgeSessionDocuments(conversationId, organizationId)
  if (!purge.ok) {
    console.error(
      `[conversations] session document cleanup incomplete for ${conversationId} — ` +
        `${purge.retained} row(s) retained for retry:`,
      purge.failures.join('; ')
    )
    throw new UpstreamError(
      'Deleting the chat’s attachments failed; the chat was kept so it can be retried.'
    )
  }

  const collection = await deleteSessionCollection(sessionCollectionName(conversationId))
  if (!collection.ok) {
    console.error(
      `[conversations] session collection erase incomplete for ${conversationId}:`,
      collection.reason
    )
    throw new UpstreamError(
      'Deleting the chat’s attachments failed; the chat was kept so it can be retried.'
    )
  }

  await deleteConversationInOrg(conversationId, organizationId)

  await purgeConversationCollaboration(conversationId)

  await recordConversationErased(conversationId, organizationId)

  await discardConversationDrafts(conversationId)
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

const AGENT_ADDRESSED: AddresseeSet = { agent: true, users: [] }

const THREAD_ADDRESSED: AddresseeSet = { agent: false, users: [] }
const NOBODY_ADDRESSED: AddresseeSet = { agent: false, users: [] }

const MENTION_EXCERPT_MAX = 280

interface PreparedMessage {
  input: CreateMessageInput
  addressees: AddresseeSet | null
  createdRequests: number
}

function buildMessageRow(
  conversationId: string,
  prepared: PreparedMessage,
  authorUserId: string | null
) {
  const { input } = prepared
  const {
    addressees: _clientRuling,
    prompt: clientPrompt,
    ...clientMetadata
  } = input.metadata ?? {}
  const prompt = sanitizePromptDetail(clientPrompt)
  return {
    id: input.id,
    conversationId,
    role: input.role,
    authorUserId: input.role === 'user' ? authorUserId : null,
    content: input.content,
    metadata: {
      ...clientMetadata,
      ...(prompt ? { prompt } : {}),
      ...(input.messageType ? { messageType: input.messageType } : {}),
      ...(prepared.addressees ? { addressees: prepared.addressees } : {}),
    },
    createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
  }
}

function storedAddressees(row: Message | null): AddresseeSet | null {
  const stored = (row?.metadata as { addressees?: unknown } | null)?.addressees
  if (!stored || typeof stored !== 'object') return null
  const candidate = stored as Partial<AddresseeSet>
  if (typeof candidate.agent !== 'boolean' || !Array.isArray(candidate.users)) return null
  return {
    agent: candidate.agent,
    users: candidate.users.filter((id): id is string => typeof id === 'string'),
  }
}

async function prepareMessage(
  session: AuthorizedSession,
  conversationId: string,
  input: CreateMessageInput,
  context: { shared: boolean; engagement: () => Promise<EngagementState> }
): Promise<PreparedMessage> {
  if (input.role !== 'user') {
    return { input, addressees: null, createdRequests: 0 }
  }

  const mentions = input.mentions ?? []
  if (mentions.length === 0) {
    if (!context.shared) {
      return { input, addressees: AGENT_ADDRESSED, createdRequests: 0 }
    }

    if (await threadIsAwaitingHuman('conversation', conversationId)) {
      return { input, addressees: THREAD_ADDRESSED, createdRequests: 0 }
    }

    const { mode } = await context.engagement()
    return {
      input,
      addressees: mode === 'mention' ? THREAD_ADDRESSED : AGENT_ADDRESSED,
      createdRequests: 0,
    }
  }

  if (!isCollaborationEnabled(session)) throw new FeatureDisabledError(FEATURE_FLAGS.collaboration)

  const existing = storedAddressees(await findMessageInConversation(conversationId, input.id))
  if (existing) return { input, addressees: existing, createdRequests: 0 }

  const applied = await applyMessageMentions({
    session,
    resourceType: 'conversation',
    resourceId: conversationId,
    anchorId: input.id,
    mentions,
    note: input.mentionNote ?? input.content.slice(0, MENTION_EXCERPT_MAX) ?? null,
    excerpt: input.content.slice(0, MENTION_EXCERPT_MAX),
  })
  return { input, addressees: applied.addressees, createdRequests: applied.createdRequests }
}

async function screenedInputs<
  T extends { role: string; content: string; mentionNote?: string | null; metadata?: Record<string, unknown> },
>(organizationId: string, inputs: T[], options: { wholeText?: boolean } = {}): Promise<T[]> {
  const mask = async (text: string): Promise<string> => (await maskChatText(organizationId, text)).text
  const maskContent = async (input: T): Promise<string> =>
    input.role === 'user' || options.wholeText
      ? mask(input.content)
      : (await maskAnswerText(organizationId, input.content)).text
  return Promise.all(
    inputs.map(async (input) => ({
      ...input,
      content: await maskContent(input),
      ...(input.mentionNote ? { mentionNote: await mask(input.mentionNote) } : {}),
      ...(input.metadata?.promptState !== undefined
        ? {
            metadata: {
              ...input.metadata,
              promptState: await screenedPromptState(organizationId, input.metadata.promptState),
            },
          }
        : {}),
    }))
  )
}

async function screenedPromptState(
  organizationId: string,
  raw: unknown
): Promise<StoredPromptState | undefined> {
  const promptState = sanitizePromptState(raw)
  if (!promptState) return undefined
  return { ...promptState, response: (await maskChatText(organizationId, promptState.response)).text }
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
      (input.mentions ?? []).some((mention) => mention.targetId === AGENT_MENTION_ID)
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

interface FanOutInput {
  shared?: boolean
  organizationId: string
  conversationId: string
  visibility: ResourceVisibility
  actorUserId: string | null
  rows: Message[]
  turnStartedFor: readonly string[]
  emitAmbient: boolean
  title?: string | null
}

async function fanOutMessageActivity(input: FanOutInput): Promise<void> {
  const { organizationId, conversationId, actorUserId } = input
  if (input.rows.length === 0) return

  try {
    const shared =
      input.shared ??
      isShared(
        input.visibility,
        input.visibility === 'private'
          ? await countGrantsForResource('conversation', conversationId)
          : 0
      )
    if (!shared) return

    const participants = await resolveParticipants(organizationId, 'conversation', conversationId)
    if (participants.length === 0) return

    for (const row of input.rows) {
      await publishToUsers(participants, {
        kind: 'conversation.message',
        conversationId,
        authorUserId: row.authorUserId,
        messageId: row.id,
      })
      if (input.turnStartedFor.includes(row.id)) {
        await publishToUsers(participants, {
          kind: 'conversation.turn',
          conversationId,
          phase: 'started',
          actorUserId,
        })
      }
      if (row.role === 'assistant') {
        await publishToUsers(participants, {
          kind: 'conversation.turn',
          conversationId,
          phase: 'ended',
          actorUserId,
        })
      }
    }

    if (!input.emitAmbient) return

    const subject =
      input.title ?? (await findConversationInOrg(conversationId, organizationId))?.title ?? null

    await emitInboxItems(
      participants.map((recipientUserId) => ({
        organizationId,
        recipientUserId,
        type: 'conversation.activity' as const,
        resourceType: 'conversation' as const,
        resourceId: conversationId,
        actorUserId,
        payload: subject ? { subject } : {},
        groupKey: inboxGroupKey('conversation.activity', 'conversation', conversationId),
      }))
    )
  } catch (error) {
    console.warn('[conversations] participant fan-out failed (non-fatal):', error)
  }
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
