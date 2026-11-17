import 'server-only'
import { and, desc, eq, exists, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { stripJsonNullBytes } from '@/lib/text/jsonb'
import { answerFeedback } from '@/lib/db/schema/answer-feedback'
import { conversationReads, type ConversationRead } from '@/lib/db/schema/conversation-reads'
import { conversationRestrictedFolders } from '@/lib/db/schema/conversation-restricted-folders'
import { conversationSourceProjects } from '@/lib/db/schema/conversation-source-projects'
import { conversations, type Conversation } from '@/lib/db/schema/conversations'
import { DELETION_LIFECYCLE, deletionQueue } from '@/lib/db/schema/deletion-queue'
import { messages, type Message, type NewMessage } from '@/lib/db/schema/messages'
import { mergeMetadataEntries } from './metadata-merge'
import { projects } from '@/lib/db/schema/projects'
import { resourceShares, type ShareableResourceType, type ResourceVisibility } from '@/lib/db/schema/resource-shares'

export const CONVERSATION_LIST_LIMIT = 200

export const MESSAGE_LIST_LIMIT = 1000

function grantNamesCaller(organizationId: string, userId: string) {
  const db = getDb()
  return exists(
    db
      .select({ one: sql`1` })
      .from(resourceShares)
      .where(
        and(
          eq(resourceShares.organizationId, organizationId),
          eq(resourceShares.resourceType, 'conversation'),
          eq(resourceShares.resourceId, conversations.id),
          eq(resourceShares.subjectUserId, userId),
        ),
      ),
  )
}

export function visibleConversationsWhere(
  organizationId: string,
  userId: string,
  projects: { projectIds: readonly string[]; withoutContainer: boolean } | null,
): SQL {
  const orgScope = eq(conversations.organizationId, organizationId)
  const mine = eq(conversations.createdBy, userId)
  const granted = grantNamesCaller(organizationId, userId)

  const withoutContainer = or(mine, granted, eq(conversations.visibility, 'organization'))
  if (!projects) return and(orgScope, withoutContainer) as SQL

  const { projectIds } = projects
  const inProjects =
    projectIds.length === 0
      ? undefined
      : and(
          projectIds.length === 1
            ? eq(conversations.projectId, projectIds[0])
            : inArray(conversations.projectId, [...projectIds]),
          or(ne(conversations.visibility, 'private'), mine, granted),
        )
  const unstamped = projects.withoutContainer ? and(isNull(conversations.projectId), withoutContainer) : undefined
  return and(orgScope, or(inProjects, unstamped) ?? sql`false`) as SQL
}

export async function listVisibleConversations(
  organizationId: string,
  userId: string,
  options: { projectId?: string; limit?: number; after?: string } = {},
): Promise<Conversation[]> {
  const { projectId, limit = CONVERSATION_LIST_LIMIT, after } = options
  const db = getDb()
  const scope = visibleConversationsWhere(
    organizationId,
    userId,
    projectId ? { projectIds: [projectId], withoutContainer: true } : null,
  )

  const afterCursor = after
    ? sql`(${conversations.updatedAt}, ${conversations.id}) < (select c.updated_at, c.id from conversations c where c.id = ${after} and c.organization_id = ${organizationId})`
    : undefined
  return db
    .select()
    .from(conversations)
    .where(and(scope, afterCursor))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(limit)
}

export async function findConversationInOrg(
  conversationId: string,
  organizationId: string,
): Promise<Conversation | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1)
  return row ?? null
}

export async function listConversationIdsForProject(
  projectId: string,
  organizationId: string,
  limit = 5_000,
): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.projectId, projectId)))
    .limit(limit)
  return rows.map((row) => row.id)
}

function writtenBy(userId: string) {
  return or(
    eq(messages.authorUserId, userId),
    and(isNull(messages.authorUserId), eq(messages.role, 'user'), eq(conversations.createdBy, userId)),
  )
}

export async function hasWrittenInOrganization(organizationId: string, userId: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(messages)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.organizationId, messages.organizationId),
      ),
    )
    .where(and(eq(messages.organizationId, organizationId), writtenBy(userId)))
    .limit(1)
  return rows.length > 0
}

export async function lastProjectActivityByUser(
  organizationId: string,
  userId: string,
  projectIds: readonly string[],
): Promise<Record<string, string>> {
  if (projectIds.length === 0) return {}
  const db = getDb()
  const rows = await db
    .select({
      projectId: conversations.projectId,
      lastActivityAt: sql<string | Date>`max(${messages.createdAt})`,
    })
    .from(messages)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, messages.conversationId),
        eq(conversations.organizationId, messages.organizationId),
      ),
    )
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        inArray(conversations.projectId, [...projectIds]),
        isNull(conversations.deletedAt),
        writtenBy(userId),
      ),
    )
    .groupBy(conversations.projectId)

  const activity: Record<string, string> = {}
  for (const row of rows) {
    if (!row.projectId) continue
    const at = row.lastActivityAt instanceof Date ? row.lastActivityAt : new Date(row.lastActivityAt)
    if (Number.isNaN(at.getTime())) continue
    activity[row.projectId] = at.toISOString()
  }
  return activity
}

export async function conversationIdsExisting(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const db = getDb()
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, [...ids]))
  return new Set(rows.map((row) => row.id))
}

export async function findConversationTenancy(
  conversationId: string,
): Promise<Pick<Conversation, 'organizationId' | 'projectId' | 'visibility' | 'createdBy' | 'deletedAt'> | null> {
  const db = getDb()
  const [row] = await db
    .select({
      organizationId: conversations.organizationId,
      projectId: conversations.projectId,
      visibility: conversations.visibility,
      createdBy: conversations.createdBy,
      deletedAt: conversations.deletedAt,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return row ?? null
}

export async function updateConversationVisibilityInOrg(
  conversationId: string,
  organizationId: string,
  visibility: ResourceVisibility,
  executor: DbExecutor = getDb(),
): Promise<Conversation | null> {
  const [row] = await executor
    .update(conversations)
    .set({ visibility, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .returning()
  return row ?? null
}

export async function insertConversation(values: {
  id: string
  organizationId: string
  createdBy: string
  title: string | null
  projectId: string | null
  visibility?: ResourceVisibility
  jobId?: string | null
  subjectResourceType?: ShareableResourceType | null
  subjectResourceId?: string | null
  temporary?: boolean
}): Promise<Conversation | null> {
  const [row] = await getDb().insert(conversations).values(values).onConflictDoNothing().returning()
  return row ?? null
}

export async function updateConversationTitleInOrg(
  conversationId: string,
  organizationId: string,
  title: string,
): Promise<Conversation | null> {
  const db = getDb()
  const [row] = await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .returning()
  return row ?? null
}

export async function updateConversationMetaInOrg(
  conversationId: string,
  organizationId: string,
  meta: { title: string; tags: string[] },
): Promise<Conversation | null> {
  const db = getDb()
  const [row] = await db
    .update(conversations)
    .set({ title: meta.title, tags: meta.tags, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .returning()
  return row ?? null
}

export async function markConversationDeleting(
  conversationId: string,
  organizationId: string,
  requestedBy: string,
): Promise<Conversation | null> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(conversations)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
      .returning()
    if (!row) return null
    await tx
      .insert(deletionQueue)
      .values({
        entityType: 'conversation',
        entityId: conversationId,
        displayName: row.title?.trim() || 'Chat',
        organizationId,
        requestedBy,
        purgeAfter: new Date(now.getTime() + CONVERSATION_ERASURE_RETRY_DELAY_MS),
      })
      .onConflictDoNothing()
    return row
  })
}

export const CONVERSATION_ERASURE_RETRY_DELAY_MS = 10 * 60_000

export async function recordConversationErased(
  conversationId: string,
  organizationId: string,
): Promise<number> {
  const db = getDb()
  const rows = await db
    .update(deletionQueue)
    .set({ status: 'purged', purgedAt: new Date(), lastError: null })
    .where(
      and(
        eq(deletionQueue.entityType, 'conversation'),
        eq(deletionQueue.entityId, conversationId),
        eq(deletionQueue.organizationId, organizationId),
        inArray(deletionQueue.status, DELETION_LIFECYCLE.sourcesOf('close')),
      ),
    )
    .returning({ id: deletionQueue.id })
  return rows.length
}

export async function deleteConversationInOrg(conversationId: string, organizationId: string): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx
      .delete(answerFeedback)
      .where(
        and(
          eq(answerFeedback.organizationId, organizationId),
          or(
            eq(answerFeedback.conversationId, conversationId),
            sql`${answerFeedback.messageId} in (select ${messages.id}::text from ${messages} where ${messages.conversationId} = ${conversationId} and ${messages.organizationId} = ${organizationId})`
          )
        )
      )
    await tx
      .delete(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
  })
  await db
    .delete(conversationRestrictedFolders)
    .where(
      and(
        eq(conversationRestrictedFolders.organizationId, organizationId),
        eq(conversationRestrictedFolders.conversationId, conversationId),
      ),
    )
  await db
    .delete(conversationSourceProjects)
    .where(
      and(
        eq(conversationSourceProjects.organizationId, organizationId),
        eq(conversationSourceProjects.conversationId, conversationId),
      ),
    )
}

export const conversationOpenToProjectReaders = (): SQL => sql`(
  not exists (select 1 from ${conversationRestrictedFolders} r where r.organization_id = ${conversations.organizationId} and r.conversation_id = ${conversations.id})
  and not exists (select 1 from ${conversationSourceProjects} p where p.organization_id = ${conversations.organizationId} and p.conversation_id = ${conversations.id} and not exists (select 1 from ${projects} c where c.id = p.project_id and c.organization_id = p.organization_id and c.status = 'closed' and c.deleted_at is null))
)`

export async function listRecentMessagesWithCardDecisions(
  projectId: string,
  organizationId: string,
  limit: number,
): Promise<Array<{ metadata: unknown; createdAt: Date }>> {
  const db = getDb()
  const rows = await db
    .select({ metadata: messages.metadata, createdAt: messages.createdAt })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(conversations.organizationId, organizationId),
        isNull(conversations.deletedAt),
        sql`${messages.metadata} ? 'cardInteractions'`,
        conversationOpenToProjectReaders(),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit)
  return rows.map((row) => ({ metadata: row.metadata, createdAt: new Date(row.createdAt) }))
}

export async function listRunLedgersByMessageIds(
  messageIds: readonly string[],
): Promise<Map<string, unknown>> {
  const ids = [...new Set(messageIds)]
  if (ids.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select({ id: messages.id, ledger: sql<unknown>`${messages.metadata} -> 'run_ledger'` })
    .from(messages)
    .where(and(inArray(messages.id, ids), isNotNull(messages.runId)))
    .limit(ids.length)
  return new Map(rows.map((row) => [row.id, row.ledger]))
}

export async function listMessagesForConversation(
  conversationId: string,
  limit = MESSAGE_LIST_LIMIT,
): Promise<Message[]> {
  const db = getDb()
  const newestFirst = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit)
  return newestFirst.reverse()
}

export async function listMessagePage(
  conversationId: string,
  options: { limit: number; before?: string }
): Promise<{ rows: Message[]; hasMore: boolean }> {
  const db = getDb()
  const before = options.before
    ? sql`(${messages.createdAt}, ${messages.id}) < (select m.created_at, m.id from messages m where m.id = ${options.before}::uuid and m.conversation_id = ${conversationId})`
    : undefined
  const newestFirst = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), before))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(options.limit + 1)
  const hasMore = newestFirst.length > options.limit
  return { rows: newestFirst.slice(0, options.limit).reverse(), hasMore }
}

export async function findMessageInConversation(
  conversationId: string,
  messageId: string,
): Promise<Message | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
    .limit(1)
  return row ?? null
}

export async function insertMessages(values: NewMessage[]): Promise<Message[]> {
  const db = getDb()
  const safe = values.map((value) =>
    value.metadata == null ? value : { ...value, metadata: stripJsonNullBytes(value.metadata) }
  )
  return db.insert(messages).values(safe).onConflictDoNothing().returning()
}

export type MetadataPatch =
  | Record<string, unknown>
  | ((current: Record<string, unknown>) => Record<string, unknown> | null)

export async function mergeMessageMetadata(
  conversationId: string,
  messageId: string,
  patch: MetadataPatch,
  deepMergeKeys: readonly string[] = [],
): Promise<Message | null> {
  const db = getDb()
  const scope = and(eq(messages.id, messageId), eq(messages.conversationId, conversationId))

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(messages).where(scope).limit(1).for('update')
    if (!existing) return null

    const current = (existing.metadata ?? {}) as Record<string, unknown>
    const entries = typeof patch === 'function' ? patch(current) : patch
    if (!entries) return existing
    const merged = mergeMetadataEntries(current, entries, deepMergeKeys)

    const [row] = await tx
      .update(messages)
      .set({ metadata: stripJsonNullBytes(merged) })
      .where(scope)
      .returning()
    return row ?? null
  })
}

export async function writeMessageContent(
  conversationId: string,
  messageId: string,
  content: string,
  metadataPatch: Record<string, unknown>,
): Promise<Message | null> {
  const db = getDb()
  const scope = and(eq(messages.id, messageId), eq(messages.conversationId, conversationId))

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(messages).where(scope).limit(1).for('update')
    if (!existing) return null

    const merged = { ...((existing.metadata ?? {}) as Record<string, unknown>), ...metadataPatch }
    const [row] = await tx
      .update(messages)
      .set({ content, metadata: stripJsonNullBytes(merged) })
      .where(scope)
      .returning()
    return row ?? null
  })
}

export type MessageRevision = (existing: Message) => { content: string; metadata: Record<string, unknown> } | null

export async function reviseMessage(
  conversationId: string,
  messageId: string,
  revise: MessageRevision,
): Promise<Message | null> {
  const db = getDb()
  const scope = and(eq(messages.id, messageId), eq(messages.conversationId, conversationId))

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(messages).where(scope).limit(1).for('update')
    if (!existing) return null

    const revision = revise(existing)
    if (!revision) return existing
    const [row] = await tx
      .update(messages)
      .set({ content: revision.content, metadata: stripJsonNullBytes(revision.metadata) })
      .where(scope)
      .returning()
    return row ?? null
  })
}

export async function upsertConversationRead(values: {
  conversationId: string
  userId: string
  lastReadAt?: Date
  lastReadMessageId?: string | null
}): Promise<ConversationRead> {
  const db = getDb()
  const at = values.lastReadAt ?? new Date()
  const [row] = await db
    .insert(conversationReads)
    .values({
      conversationId: values.conversationId,
      userId: values.userId,
      lastReadAt: at,
      lastReadMessageId: values.lastReadMessageId ?? null,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [conversationReads.conversationId, conversationReads.userId],
      set: {
        lastReadAt: at,
        lastReadMessageId:
          values.lastReadMessageId ?? sql`${conversationReads.lastReadMessageId}`,
        updatedAt: at,
      },
    })
    .returning()
  return row
}

export async function findConversationRead(
  conversationId: string,
  userId: string,
): Promise<ConversationRead | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(conversationReads)
    .where(and(eq(conversationReads.conversationId, conversationId), eq(conversationReads.userId, userId)))
    .limit(1)
  return row ?? null
}
