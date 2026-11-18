import 'server-only'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documentNameVariants } from '../name-match'
import { documents, type Document, type DocumentAuthor } from '@/lib/db/schema/documents'
import type { DocumentScreeningOutcome } from '@/lib/db/schema/documents'
import { documentVisibleTo, internalRead } from '../visibility'
import { DOCUMENT_LIST_LIMIT } from './list'

export async function findDocumentAuthoredByRef(
  ref: string,
  organizationId: string,
  projectId: string,
  producer: string,
): Promise<Pick<Document, 'id' | 'filename' | 'folderId'> | null> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        id: documents.id,
        filename: documents.filename,
        folderId: documents.folderId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.authoredByRef, ref),
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
          eq(documents.authoredByProducer, producer),
          ne(documents.authoredBy, 'user'),
          documentVisibleTo(internalRead('identity')),
        ),
      )
      .limit(1),
  )
  return rows[0] ?? null
}

export async function findLiveDocumentByFilename(
  organizationId: string,
  collectionName: string,
  filename: string,
): Promise<{
  id: string
  storageKey: string
  storageBucket: string | null
  fileSize: number | null
  contentHash: string | null
  folderId: string | null
  status: string
  authoredBy: DocumentAuthor
  screeningOutcome: DocumentScreeningOutcome | null
  screenedHash: string | null
  createdBy: string
  scope: Document['scope']
  projectId: string | null
} | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({
        id: documents.id,
        storageKey: documents.storageKey,
        storageBucket: documents.storageBucket,
        fileSize: documents.fileSize,
        contentHash: documents.contentHash,
        folderId: documents.folderId,
        status: documents.status,
        authoredBy: documents.authoredBy,
        screeningOutcome: documents.screeningOutcome,
        screenedHash: documents.screenedHash,
        createdBy: documents.createdBy,
        scope: documents.scope,
        projectId: documents.projectId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.collectionName, collectionName),
          inArray(documents.filename, documentNameVariants(filename)),
          eq(documents.authoredBy, 'user'),
          documentVisibleTo(internalRead('identity')),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(1),
  )
  return row ?? null
}

export async function findProjectCollectionsHoldingFilename(
  organizationId: string,
  projectId: string,
  filename: string,
): Promise<string[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .selectDistinct({ collectionName: documents.collectionName })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
          eq(documents.scope, 'project'),
          inArray(documents.filename, documentNameVariants(filename)),
          eq(documents.authoredBy, 'user'),
          documentVisibleTo(internalRead('identity')),
        ),
      )
      .limit(DOCUMENT_LIST_LIMIT),
  )
  return rows.map((row) => row.collectionName)
}
