import 'server-only'

import { eq, and, ne, sql } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { conversations, type ConversationEngagement } from '@/lib/db/schema/conversations'
import { messages } from '@/lib/db/schema/messages'

export function suggestEngagement(distinctHumanAuthors: number): ConversationEngagement | null {
  return distinctHumanAuthors >= 2 ? 'mention' : null
}

export async function countDistinctHumanAuthors(
  conversationId: string,
  organizationId: string
): Promise<number> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ count: sql<number>`count(distinct ${messages.authorUserId})::int` })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.organizationId, organizationId),
          eq(messages.role, 'user'),
          sql`${messages.authorUserId} is not null`
        )
      )
  )
  return row?.count ?? 0
}

export interface EngagementState {
  mode: ConversationEngagement
  stored: ConversationEngagement | null
  suggestion: ConversationEngagement | null
}

export async function resolveEngagement(
  conversationId: string,
  organizationId: string,
  stored: ConversationEngagement | null,
  options: { withSuggestion?: boolean } = {}
): Promise<EngagementState> {
  const mode = stored ?? 'ask'
  if (!options.withSuggestion) return { mode, stored, suggestion: null }
  const suggestion = stored
    ? null
    : suggestEngagement(await countDistinctHumanAuthors(conversationId, organizationId))
  return { mode, stored, suggestion }
}

export async function findStoredEngagement(
  conversationId: string,
  organizationId: string
): Promise<ConversationEngagement | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ engagement: conversations.engagement })
      .from(conversations)
      .where(
        and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId))
      )
      .limit(1)
  )
  return row?.engagement ?? null
}

export async function resolveEngagementFor(
  conversationId: string,
  organizationId: string
): Promise<EngagementState> {
  return resolveEngagement(
    conversationId,
    organizationId,
    await findStoredEngagement(conversationId, organizationId)
  )
}

export async function setEngagement(
  conversationId: string,
  organizationId: string,
  mode: ConversationEngagement
): Promise<boolean> {
  const db = getDb()
  const updated = await withTenant({ organizationId }, () =>
    db
      .update(conversations)
      .set({ engagement: mode })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.organizationId, organizationId),
          ne(sql`coalesce(${conversations.engagement}, '')`, mode)
        )
      )
      .returning({ id: conversations.id })
  )
  return updated.length > 0
}
