import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations, type Conversation } from '@/lib/db/schema/conversations'

export async function readConversationTemporary(conversationId: string, organizationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ temporary: conversations.temporary })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1)
  return row?.temporary ?? false
}

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
