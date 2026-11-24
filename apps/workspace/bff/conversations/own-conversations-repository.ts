import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations } from '@/lib/db/schema/conversations'
import { deletionQueue } from '@/lib/db/schema/deletion-queue'
import { CONVERSATION_ERASURE_RETRY_DELAY_MS } from './repository'

export type ConversationSide = { projectId: string | null }

export interface MarkedOwnConversations {
  markedAt: Date
  marked: { id: string; title: string | null }[]
  held: { id: string; title: string | null }[]
}

export async function markOwnConversationsDeleting(
  organizationId: string,
  userId: string,
  side: ConversationSide,
): Promise<MarkedOwnConversations> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const markedAt = new Date()
    const candidates = await tx
      .select({
        id: conversations.id,
        title: conversations.title,
        held: sql<boolean>`legal_hold_blocks('conversation', ${conversations.id}, ${conversations.organizationId})`,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.createdBy, userId),
          isNull(conversations.deletedAt),
          isNull(conversations.jobId),
          side.projectId === null ? isNull(conversations.projectId) : eq(conversations.projectId, side.projectId),
        ),
      )
    const held = candidates.filter((row) => row.held === true).map(({ id, title }) => ({ id, title }))
    const erasable = candidates.filter((row) => row.held !== true)
    if (erasable.length === 0) return { markedAt, marked: [], held }

    const marked = await tx
      .update(conversations)
      .set({ deletedAt: markedAt, updatedAt: markedAt })
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.createdBy, userId),
          isNull(conversations.deletedAt),
          inArray(conversations.id, erasable.map((row) => row.id)),
        ),
      )
      .returning({ id: conversations.id, title: conversations.title })
    if (marked.length > 0) {
      await tx
        .insert(deletionQueue)
        .values(
          marked.map((row) => ({
            entityType: 'conversation' as const,
            entityId: row.id,
            displayName: row.title?.trim() || 'Chat',
            organizationId,
            requestedBy: userId,
            purgeAfter: new Date(markedAt.getTime() + CONVERSATION_ERASURE_RETRY_DELAY_MS),
          })),
        )
        .onConflictDoNothing()
    }
    return { markedAt, marked, held }
  })
}

export async function listMarkedOwnConversationIds(
  organizationId: string,
  userId: string,
  markedAt: Date,
  options: { after: string | null; limit: number },
): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.createdBy, userId),
        eq(conversations.deletedAt, markedAt),
        options.after ? sql`${conversations.id} > ${options.after}` : undefined,
      ),
    )
    .orderBy(conversations.id)
    .limit(options.limit)
  return rows.map((row) => row.id)
}
