import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { mailThreads } from '@/lib/db/schema/mail-thread'

export interface DocumentMailThread {
  entryCount: number
  lastEntryAt: string | null
}

export async function mailThreadsOfDocuments(
  organizationId: string,
  documentIds: readonly string[],
): Promise<Map<string, DocumentMailThread>> {
  if (documentIds.length === 0) return new Map()
  const rows = await getDb()
    .select({ documentId: mailThreads.documentId, entryCount: mailThreads.entryCount, lastEntryAt: mailThreads.lastEntryAt })
    .from(mailThreads)
    .where(and(eq(mailThreads.organizationId, organizationId), inArray(mailThreads.documentId, [...documentIds])))
  const byDocument = new Map<string, DocumentMailThread>()
  for (const row of rows) {
    if (!row.documentId) continue
    byDocument.set(row.documentId, {
      entryCount: row.entryCount,
      lastEntryAt: row.lastEntryAt ? new Date(row.lastEntryAt).toISOString() : null,
    })
  }
  return byDocument
}
