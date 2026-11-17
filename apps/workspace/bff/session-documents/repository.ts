import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documents, type Document } from '@/lib/db/schema/documents'
import { DOCUMENT_LIST_LIMIT, type DocumentListRow } from '@/lib/documents/repository'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'

export const SESSION_DOCUMENT_LIST_LIMIT = 100

export async function listSessionDocuments(
  conversationId: string,
  organizationId: string,
  reader: DocumentReader,
  limit = SESSION_DOCUMENT_LIST_LIMIT,
): Promise<DocumentListRow[]> {
  const boundedLimit = Math.min(Math.max(1, Math.trunc(limit)), DOCUMENT_LIST_LIMIT)
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select({
        id: documents.id,
        filename: documents.filename,
        projectId: documents.projectId,
        scope: documents.scope,
        displayName: documents.displayName,
        fileSize: documents.fileSize,
        contentType: documents.contentType,
        contentHash: documents.contentHash,
        createdBy: documents.createdBy,
        screeningOutcome: documents.screeningOutcome,
        screenedHash: documents.screenedHash,
        status: documents.status,
        authoredBy: documents.authoredBy,
        publishedVersionId: documents.publishedVersionId,
      lifecycle: documents.lifecycle,
        collectionName: documents.collectionName,
        folderId: documents.folderId,
        originPath: documents.originPath,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        errorMessage: documents.errorMessage,
        quarantine: documents.quarantine,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'session'),
          eq(documents.conversationId, conversationId),
          documentVisibleTo(reader),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(boundedLimit),
  )
}

export async function listSessionDocumentsForCleanup(
  conversationId: string,
  organizationId: string,
  limit = SESSION_DOCUMENT_LIST_LIMIT,
): Promise<Document[]> {
  const boundedLimit = Math.min(Math.max(1, Math.trunc(limit)), DOCUMENT_LIST_LIMIT)
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'session'),
          eq(documents.conversationId, conversationId),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(boundedLimit),
  )
}

export async function findSessionDocument(
  documentId: string,
  organizationId: string,
  reader: DocumentReader,
): Promise<Document | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'session'),
          documentVisibleTo(reader),
        ),
      )
      .limit(1),
  )
  return row ?? null
}

export async function deleteSessionDocument(
  documentId: string,
  organizationId: string,
  conversationId: string,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .delete(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'session'),
          eq(documents.conversationId, conversationId),
        ),
      ),
  )
}

export async function deleteSessionDocumentsByIds(
  documentIds: string[],
  organizationId: string,
  conversationId: string,
): Promise<void> {
  if (documentIds.length === 0) return
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .delete(documents)
      .where(
        and(
          inArray(documents.id, documentIds),
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'session'),
          eq(documents.conversationId, conversationId),
        ),
      ),
  )
}
