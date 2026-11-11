import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations, type Conversation } from '@/lib/db/schema/conversations'

/**
 * The SQL of a conversation's `temporary` flag (ADR-0180 rule 2, migration
 * 0229). Beside `repository.ts` rather than in it: that file is held at its
 * size by the ratchet.
 */

/**
 * Whether the conversation is temporary, scoped to the organization in SQL.
 * False when no such row exists: a first turn names a client-generated id
 * before its row is written, and a conversation of another organization is
 * not this one's to refuse on.
 */
export async function readConversationTemporary(conversationId: string, organizationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ temporary: conversations.temporary })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1)
  return row?.temporary ?? false
}

/** Set the flag, scoped to the organization in SQL. Null when no such row exists (the caller maps to 404). */
export async function updateConversationTemporaryInOrg(
  conversationId: string,
  organizationId: string,
  temporary: boolean
): Promise<Conversation | null> {
  const [row] = await getDb()
    .update(conversations)
    .set({ temporary, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .returning()
  return row ?? null
}
