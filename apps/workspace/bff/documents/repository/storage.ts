import 'server-only'
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withOptionalTenant } from '@/lib/db/tenant-context'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { NAMESPACED_AGENT_PRODUCERS } from '../agent-namespace'
import { outsideTheBin } from '../shelf'
import { documentVisibleTo, internalRead, SCREENED_ONLY } from '../visibility'

export interface StoredDocumentFile {
  id: string
  storageKey: string
  storageBucket: string | null
  contentType: string | null
  versionId: string | null
}

const storedFileColumns = {
  id: documents.id,
  storageKey: documents.storageKey,
  storageBucket: documents.storageBucket,
  contentType: documents.contentType,
  versionId: documents.publishedVersionId,
}

function readableUserFileIn(collectionName: string, organizationId: string | undefined): SQL[] {
  return [
    eq(documents.collectionName, collectionName),
    eq(documents.authoredBy, 'user'),
    ...(organizationId ? [eq(documents.organizationId, organizationId)] : []),
  ]
}

const NAME_AMBIGUITY_PROBE = 2

export async function findStorageKeysByCollectionAndFilename(
  collectionName: string,
  filename: string,
  organizationId?: string,
): Promise<StoredDocumentFile[]> {
  const db = getDb()
  return withOptionalTenant(
    organizationId,
    'internal document-file lookup: the service-token caller identifies the row by its ' +
      'unguessable collection name and carries no organization',
    () =>
      db
        .select(storedFileColumns)
        .from(documents)
        .where(
          and(
            eq(documents.filename, filename),
            ...readableUserFileIn(collectionName, organizationId),
            eq(documents.lifecycle, 'active'),
            outsideTheBin(),
            documentVisibleTo(SCREENED_ONLY),
          ),
        )
        .orderBy(desc(documents.createdAt))
        .limit(NAME_AMBIGUITY_PROBE),
  )
}

export async function findReadableStorageKeyById(
  documentId: string,
  collectionName: string,
  organizationId?: string,
): Promise<StoredDocumentFile | null> {
  const db = getDb()
  const [row] = await withOptionalTenant(
    organizationId,
    'internal document-file lookup: the service-token caller identifies the row by its ' +
      'unguessable document id and collection name and carries no organization',
    () =>
      db
        .select(storedFileColumns)
        .from(documents)
        .where(
          and(eq(documents.id, documentId), ...readableUserFileIn(collectionName, organizationId), documentVisibleTo(SCREENED_ONLY)),
        )
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

export interface CollectionDocumentId {
  id: string
  filename: string
  folderId: string | null
}

export async function listDocumentIdsInCollection(
  collectionName: string,
  organizationId?: string,
): Promise<CollectionDocumentId[]> {
  const db = getDb()
  return withOptionalTenant(
    organizationId,
    'internal document-ids: the backend maps the names its index stored to document ids, per ' +
      'unguessable collection name, and carries no organization for a project collection',
    () =>
      db
        .select({ id: documents.id, filename: documents.filename, folderId: documents.folderId })
        .from(documents)
        .where(
          and(
            eq(documents.collectionName, collectionName),
            ...(organizationId ? [eq(documents.organizationId, organizationId)] : []),
            or(eq(documents.authoredBy, 'user'), inArray(documents.authoredByProducer, [...NAMESPACED_AGENT_PRODUCERS])),
            documentVisibleTo(internalRead('identity')),
          ),
        )
        .orderBy(asc(documents.id)),
  )
}
