import 'server-only'

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { inboundMailParts, inboundMails, type InboundMailPartRow } from '@/lib/db/schema/inbound-mail'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'

export interface ProjectNoticeState {
  waiting: boolean
  expiring: boolean
}

export async function projectNoticeState(projectId: string): Promise<ProjectNoticeState> {
  const [row] = await getDb()
    .select({
      waiting: sql<boolean>`bool_or(true)`,
      expiring: sql<boolean>`coalesce(bool_or(${inboundMails.expiringNotifiedAt} IS NOT NULL), false)`,
    })
    .from(inboundMails)
    .where(
      and(
        eq(inboundMails.projectId, projectId),
        eq(inboundMails.status, 'waiting'),
        sql`EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id} AND p.state = 'waiting')`,
      ),
    )
  return { waiting: row?.waiting === true, expiring: row?.expiring === true }
}

export async function waitingMailCounts(projectIds: readonly string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map()
  const rows = await getDb()
    .select({ projectId: inboundMails.projectId, count: sql<number>`count(*)::int` })
    .from(inboundMails)
    .where(
      and(
        inArray(inboundMails.projectId, [...projectIds]),
        eq(inboundMails.status, 'waiting'),
        sql`EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id} AND p.state = 'waiting')`,
      ),
    )
    .groupBy(inboundMails.projectId)
  return new Map(rows.map((row) => [row.projectId, Number(row.count)]))
}

export async function filedFolderIds(mailId: string, reader: DocumentReader): Promise<Array<string | null>> {
  const rows = await getDb()
    .select({ folderId: documents.folderId })
    .from(inboundMailParts)
    .innerJoin(documents, eq(documents.id, inboundMailParts.documentId))
    .where(
      and(
        eq(inboundMailParts.mailId, mailId),
        eq(inboundMailParts.state, 'filed'),
        isNotNull(inboundMailParts.documentId),
        documentVisibleTo(reader),
      ),
    )
    .limit(201)
  return rows.map((row) => row.folderId)
}

export async function partStatesOf(mailIds: readonly string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(mailIds)].slice(0, 50)
  const byMail = new Map<string, string[]>()
  if (ids.length === 0) return byMail
  const rows = await getDb()
    .select({ mailId: inboundMailParts.mailId, state: inboundMailParts.state })
    .from(inboundMailParts)
    .where(inArray(inboundMailParts.mailId, ids))
    .limit(ids.length * 201)
  for (const row of rows) byMail.set(row.mailId, [...(byMail.get(row.mailId) ?? []), row.state])
  return byMail
}

export async function partOutcomesOf(mailId: string): Promise<Array<Pick<InboundMailPartRow, 'id' | 'state' | 'lastFailure'>>> {
  return getDb()
    .select({ id: inboundMailParts.id, state: inboundMailParts.state, lastFailure: inboundMailParts.lastFailure })
    .from(inboundMailParts)
    .where(eq(inboundMailParts.mailId, mailId))
    .limit(201)
}
