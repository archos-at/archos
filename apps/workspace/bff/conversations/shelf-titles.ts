import 'server-only'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { actingOwnShelfReadable, actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { getDb } from '@/lib/db'
import { conversations } from '@/lib/db/schema/conversations'
import { withTenant } from '@/lib/db/tenant-context'

export interface ShelfMarkedChat {
  createdBy: string
  personalShelfUsedAt: Date | null
}

export function hidesShelfChatFromAgent(chat: ShelfMarkedChat, userId: string): boolean {
  if (!actingReaderIsAgent() || !chat.personalShelfUsedAt) return false
  return !(chat.createdBy === userId && actingOwnShelfReadable())
}

export async function shelfChatsHiddenFromAgent(
  organizationId: string,
  userId: string,
  conversationIds: readonly string[],
): Promise<Set<string>> {
  if (!actingReaderIsAgent() || conversationIds.length === 0) return new Set()
  const rows = await withTenant({ organizationId, userId }, () =>
    getDb()
      .select({ id: conversations.id, createdBy: conversations.createdBy, personalShelfUsedAt: conversations.personalShelfUsedAt })
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          inArray(conversations.id, [...new Set(conversationIds)]),
          isNotNull(conversations.personalShelfUsedAt),
        ),
      ),
  )
  return new Set(rows.filter((row) => hidesShelfChatFromAgent(row, userId)).map((row) => row.id))
}
