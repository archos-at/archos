import 'server-only'
import { and, desc, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { mailThreadEntries, mailThreadEntryAttachments } from '@/lib/db/schema/mail-thread'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'
import type { InboundMailSenderFolderView } from './inbound-mail-wire'
import { SENDER_FOLDERS_SHOWN, SENDER_MEMORY_ENTRIES } from './sender-memory'

export interface SenderFoldersQuery {
  organizationId: string
  projectId: string
  senderAddress: string
  exceptMailId: string
  reader: DocumentReader
  hiddenFolderIds: readonly string[]
}

export function senderFoldersQuery(query: SenderFoldersQuery) {
  const db = getDb()
  const recent = db
    .select({ id: mailThreadEntries.id, receivedAt: mailThreadEntries.receivedAt })
    .from(mailThreadEntries)
    .where(
      and(
        eq(mailThreadEntries.organizationId, query.organizationId),
        eq(mailThreadEntries.projectId, query.projectId),
        eq(mailThreadEntries.source, 'inbound'),
        sql`lower(${mailThreadEntries.senderAddress}) = ${query.senderAddress.toLowerCase()}`,
        sql`${mailThreadEntries.inboundMailId} IS DISTINCT FROM ${query.exceptMailId}::uuid`,
      ),
    )
    .orderBy(desc(mailThreadEntries.receivedAt))
    .limit(SENDER_MEMORY_ENTRIES)
    .as('recent')
  const newest = sql`max(${recent.receivedAt})`
  return db
    .select({ folderId: projectFolders.id, path: projectFolders.path, count: sql<string>`count(*)` })
    .from(recent)
    .innerJoin(mailThreadEntryAttachments, eq(mailThreadEntryAttachments.entryId, recent.id))
    .innerJoin(documents, eq(documents.id, mailThreadEntryAttachments.documentId))
    .innerJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(
      and(
        eq(mailThreadEntryAttachments.disposition, 'filed'),
        eq(documents.projectId, query.projectId),
        eq(documents.scope, 'project'),
        eq(documents.lifecycle, 'active'),
        documentVisibleTo(query.reader),
        eq(projectFolders.scope, 'project'),
        isNull(projectFolders.deletedAt),
        query.hiddenFolderIds.length > 0 ? notInArray(projectFolders.id, [...query.hiddenFolderIds]) : undefined,
      ),
    )
    .groupBy(projectFolders.id, projectFolders.path)
    .orderBy(desc(newest), projectFolders.path)
    .limit(SENDER_FOLDERS_SHOWN)
}

export async function findSenderFolders(query: SenderFoldersQuery): Promise<InboundMailSenderFolderView[]> {
  const rows = await senderFoldersQuery(query)
  return rows.map((row) => ({ folderId: row.folderId, path: row.path, count: Number(row.count) }))
}
