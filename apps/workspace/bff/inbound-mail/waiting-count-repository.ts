import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboundMailParts, inboundMails } from '@/lib/db/schema/inbound-mail'

export const OPEN_PART_STATES = ['waiting', 'filing'] as const

export const partInState = (states: readonly string[]) =>
  sql`EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id}
      AND p.state IN (${sql.join(states.map((state) => sql`${state}`), sql`, `)}))`

export async function countWaitingMailsByProject(projectIds: readonly string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map()
  const rows = await getDb()
    .select({ projectId: inboundMails.projectId, count: sql<string>`count(*)` })
    .from(inboundMails)
    .where(and(inArray(inboundMails.projectId, [...projectIds]), eq(inboundMails.status, 'waiting'), partInState(OPEN_PART_STATES)))
    .groupBy(inboundMails.projectId)
    .limit(projectIds.length)
  return new Map(rows.map((row) => [row.projectId, Number(row.count)]))
}
