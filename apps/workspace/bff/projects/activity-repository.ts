import 'server-only'
import { and, eq, gte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations } from '@/lib/db/schema/conversations'
import { messages } from '@/lib/db/schema/messages'

export interface DailyQuestions {
  day: string
  questions: number
}

export async function countQuestionsPerDay(
  organizationId: string,
  projectId: string,
  start: Date
): Promise<DailyQuestions[]> {
  const db = getDb()
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${messages.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      questions: sql<string>`count(*)`,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.projectId, projectId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, start)
      )
    )
    .groupBy(sql`1`)

  return rows.map((row) => ({ day: row.day, questions: Number(row.questions) }))
}

export async function countAskingPeople(
  organizationId: string,
  projectId: string,
  start: Date
): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ people: sql<string>`count(distinct ${messages.authorUserId})` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.projectId, projectId),
        eq(messages.role, 'user'),
        gte(messages.createdAt, start)
      )
    )
  return Number(row?.people ?? 0)
}
