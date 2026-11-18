import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { documentVisibleTo, SCREENED_ONLY } from '@/lib/documents/visibility'
import { liveFolderAccess } from '@/lib/permits/live-access'
import { servedFrom } from '@/lib/permits/repository'

const NO_CLEARANCE: readonly string[] = []

async function extractableWhere(organizationId: string, projectId: string, collectionName: string) {
  const access = await liveFolderAccess(organizationId, projectId, NO_CLEARANCE)
  return and(
    eq(documents.organizationId, organizationId),
    eq(documents.projectId, projectId),
    eq(documents.collectionName, collectionName),
    documentVisibleTo(SCREENED_ONLY),
    eq(documents.lifecycle, 'active'),
    servedFrom(access.visibleFolderIds)
  )
}

export async function extractableFileNames(
  organizationId: string,
  projectId: string,
  collectionName: string
): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ fileName: documents.filename })
    .from(documents)
    .where(await extractableWhere(organizationId, projectId, collectionName))
    .orderBy(asc(documents.filename))
  return rows.map((row) => row.fileName)
}

export const MAX_EXTRACTABLE_DOCUMENTS = 2000

export interface ExtractableDocument {
  documentId: string
  fileName: string
  contentHash: string | null
  updatedAt: Date
}

export async function extractableDocuments(
  organizationId: string,
  projectId: string,
  collectionName: string
): Promise<ExtractableDocument[]> {
  const rows = await getDb()
    .select({
      documentId: documents.id,
      fileName: documents.filename,
      contentHash: documents.contentHash,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(await extractableWhere(organizationId, projectId, collectionName))
    .orderBy(asc(documents.filename), asc(documents.id))
    .limit(MAX_EXTRACTABLE_DOCUMENTS)
  return rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) }))
}
