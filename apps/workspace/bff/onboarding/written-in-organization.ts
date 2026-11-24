import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { writtenBy } from '@/lib/conversations/repository'
import { conversations } from '@/lib/db/schema/conversations'
import { messages } from '@/lib/db/schema/messages'

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
