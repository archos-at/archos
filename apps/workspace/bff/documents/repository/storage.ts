import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withOptionalTenant } from '@/lib/db/tenant-context'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { documentVisibleTo, internalRead, SCREENED_ONLY } from '../visibility'

export interface StoredDocumentFile {
  id: string
  storageKey: string
  storageBucket: string | null
  contentType: string | null
  versionId: string | null
}

export async function findStorageKeyByCollectionAndFilename(
  collectionName: string,
  filename: string,
  organizationId?: string,
): Promise<StoredDocumentFile | null> {
  const db = getDb()
  const [row] = await withOptionalTenant(
    organizationId,
    'internal document-file lookup: the service-token caller identifies the row by its ' +
      'unguessable collection name and carries no organization',
    () =>
      db
        .select({
          id: documents.id,
          storageKey: documents.storageKey,
          storageBucket: documents.storageBucket,
          contentType: documents.contentType,
          versionId: documents.publishedVersionId,
        })
        .from(documents)
        .where(
          and(
            eq(documents.collectionName, collectionName),
            eq(documents.filename, filename),
            eq(documents.authoredBy, 'user'),
            documentVisibleTo(SCREENED_ONLY),
            ...(organizationId ? [eq(documents.organizationId, organizationId)] : []),
          ),
        )
        .orderBy(desc(documents.createdAt))
        .limit(1),
  )
  return row ?? null
}

export async function findPageTextTarget(
  documentId: string,
  collectionName: string,
  organizationId?: string,
): Promise<{ storageKey: string; storageBucket: string | null; contentHash: string | null; version: number | null } | null> {
  const db = getDb()
  const [row] = await withOptionalTenant(
    organizationId,
    'internal page-text presign: the service-token caller identifies the row by its ' +
      'unguessable document id and collection name and carries no organization',
    () =>
      db
        .select({
          storageKey: documents.storageKey,
          storageBucket: documents.storageBucket,
          contentHash: documents.contentHash,
          version: documentVersions.versionNumber,
        })
        .from(documents)
        .leftJoin(
          documentVersions,
          and(eq(documentVersions.id, documents.publishedVersionId), eq(documentVersions.documentId, documents.id)),
        )
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.collectionName, collectionName),
            eq(documents.authoredBy, 'user'),
            ...(organizationId ? [eq(documents.organizationId, organizationId)] : []),
            documentVisibleTo(internalRead('ingest')),
          ),
        )
        .limit(1),
  )
  if (!row?.storageKey) return null
  return {
    storageKey: row.storageKey,
    storageBucket: row.storageBucket ?? null,
    contentHash: row.contentHash ?? null,
    version: row.version === null || row.version === undefined ? null : Number(row.version),
  }
}

export async function findStorageKeyByIdAndCollection(
  documentId: string,
  collectionName: string,
  organizationId?: string,
): Promise<{ storageKey: string; storageBucket: string | null } | null> {
  const db = getDb()
  const [row] = await withOptionalTenant(
    organizationId,
    'internal document-image presign: the service-token caller identifies the row by its ' +
      'unguessable document id and collection name and carries no organization',
    () =>
      db
        .select({ storageKey: documents.storageKey, storageBucket: documents.storageBucket })
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.collectionName, collectionName),
            eq(documents.authoredBy, 'user'),
            ...(organizationId ? [eq(documents.organizationId, organizationId)] : []),
            documentVisibleTo(internalRead('ingest')),
          ),
        )
        .limit(1),
  )
  return row ?? null
}

export async function documentExistsInCollection(
  documentId: string,
  collectionName: string,
  organizationId?: string,
): Promise<boolean> {
  const db = getDb()
  const [row] = await withOptionalTenant(
    organizationId,
    'internal document-exists: the ingest pipeline identifies the row by its unguessable ' +
      'document id and collection name, and carries no organization for a project collection',
    () =>
      db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.collectionName, collectionName),
            ...(organizationId ? [eq(documents.organizationId, organizationId)] : []),
            eq(documents.lifecycle, 'active'),
            sql`NOT EXISTS (SELECT 1 FROM project_folders f WHERE f.id = ${documents.folderId} AND f.deleted_at IS NOT NULL)`,
            documentVisibleTo(internalRead('ingest')),
          ),
        )
        .limit(1),
  )
  return row !== undefined
}
