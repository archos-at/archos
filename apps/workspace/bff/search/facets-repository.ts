import 'server-only'
import { and, asc, count, eq, getTableColumns, gt, inArray, isNull, lt, max, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentSearchFacets, documentSearchShelves, type DocumentSearchShelfRow, type NewDocumentSearchFacetsRow } from '@/lib/db/schema/document-search'
import { documents } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { shelfDocumentWhere, type DocumentShelf } from '@/lib/documents/shelf'

export const STALE_FINGERPRINT = 'stale'

export const PROJECTION_PAGE_SIZE = 200

export function shelfKey(shelf: DocumentShelf): string {
  return shelf.kind === 'project' ? `project:${shelf.projectId}` : 'office_shelf'
}

export function shelfOfKey(key: string): DocumentShelf | null {
  if (key === 'office_shelf') return { kind: 'office_shelf' }
  const match = /^project:([0-9a-f-]{36})$/.exec(key)
  return match ? { kind: 'project', projectId: match[1] } : null
}

export async function deleteSearchFacets(organizationId: string, documentId: string): Promise<void> {
  await withTenant({ organizationId }, () =>
    getDb()
      .delete(documentSearchFacets)
      .where(and(eq(documentSearchFacets.organizationId, organizationId), eq(documentSearchFacets.documentId, documentId)))
  )
}

export async function upsertSearchFacets(organizationId: string, rows: readonly NewDocumentSearchFacetsRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const now = new Date()
  const values = rows.map((row) => ({ ...row, organizationId, syncedAt: now }))
  const written = await withTenant({ organizationId }, () =>
    getDb()
      .insert(documentSearchFacets)
      .values(values)
      .onConflictDoUpdate({
        target: documentSearchFacets.documentId,
        set: excludedColumns(),
        setWhere: sql`${documentSearchFacets.fingerprint} IS DISTINCT FROM excluded.fingerprint`,
      })
      .returning({ documentId: documentSearchFacets.documentId })
  )
  return written.length
}

function excludedColumns(): Record<string, SQL> {
  const set: Record<string, SQL> = {}
  for (const [key, column] of Object.entries(getTableColumns(documentSearchFacets))) {
    if (key === 'documentId' || key === 'organizationId') continue
    set[key] = sql.raw(`excluded."${column.name}"`)
  }
  return set
}

export interface ProjectionDocument {
  id: string
  filename: string
  collectionName: string
  authoredBy: 'user' | 'agent'
  publishedVersionId: string | null
}

export async function listShelfDocumentsForProjection(
  organizationId: string,
  shelf: DocumentShelf,
  afterId: string | null
): Promise<ProjectionDocument[]> {
  return withTenant({ organizationId }, () =>
    getDb()
      .select({
        id: documents.id,
        filename: documents.filename,
        collectionName: documents.collectionName,
        authoredBy: documents.authoredBy,
        publishedVersionId: documents.publishedVersionId,
      })
      .from(documents)
      .where(and(shelfDocumentWhere(shelf, organizationId), afterId ? gt(documents.id, afterId) : undefined))
      .orderBy(asc(documents.id))
      .limit(PROJECTION_PAGE_SIZE)
  ) as Promise<ProjectionDocument[]>
}

export async function shelfSourceFingerprints(
  organizationId: string,
  shelves: readonly DocumentShelf[]
): Promise<Map<string, string>> {
  const projectIds = shelves.flatMap((shelf) => (shelf.kind === 'project' ? [shelf.projectId] : []))
  const officeShelf = shelves.some((shelf) => shelf.kind === 'office_shelf')
  if (projectIds.length === 0 && !officeShelf) return new Map()
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({
        scope: documents.scope,
        projectId: documents.projectId,
        documents: count(),
        newest: max(documents.updatedAt),
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          or(
            projectIds.length > 0 ? and(eq(documents.scope, 'project'), inArray(documents.projectId, projectIds)) : undefined,
            officeShelf ? eq(documents.scope, 'office_shelf') : undefined
          )
        )
      )
      .groupBy(documents.scope, documents.projectId)
  )
  const fingerprints = new Map<string, string>()
  for (const shelf of shelves) fingerprints.set(shelfKey(shelf), '0')
  for (const row of rows) {
    const key = row.scope === 'office_shelf' ? 'office_shelf' : `project:${row.projectId}`
    const newest = row.newest ? new Date(row.newest).toISOString() : '-'
    fingerprints.set(key, `${Number(row.documents)}@${newest}`)
  }
  return fingerprints
}

export async function readShelfSyncStates(organizationId: string, keys: readonly string[]): Promise<DocumentSearchShelfRow[]> {
  if (keys.length === 0) return []
  return withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(documentSearchShelves)
      .where(and(eq(documentSearchShelves.organizationId, organizationId), inArray(documentSearchShelves.shelfKey, [...keys])))
  )
}

export async function claimShelfRefresh(organizationId: string, shelf: DocumentShelf, minIntervalMs: number): Promise<boolean> {
  const now = new Date()
  const claimed = await withTenant({ organizationId }, () =>
    getDb()
      .insert(documentSearchShelves)
      .values({
        organizationId,
        shelfKey: shelfKey(shelf),
        projectId: shelf.kind === 'project' ? shelf.projectId : null,
        refreshRequestedAt: now,
      })
      .onConflictDoUpdate({
        target: [documentSearchShelves.organizationId, documentSearchShelves.shelfKey],
        set: { refreshRequestedAt: now },
        setWhere: or(
          isNull(documentSearchShelves.refreshRequestedAt),
          lt(documentSearchShelves.refreshRequestedAt, new Date(now.getTime() - minIntervalMs))
        ),
      })
      .returning({ shelfKey: documentSearchShelves.shelfKey })
  )
  return claimed.length > 0
}

export async function markShelfSynced(organizationId: string, shelf: DocumentShelf, sourceFingerprint: string): Promise<void> {
  const now = new Date()
  await withTenant({ organizationId }, () =>
    getDb()
      .insert(documentSearchShelves)
      .values({
        organizationId,
        shelfKey: shelfKey(shelf),
        projectId: shelf.kind === 'project' ? shelf.projectId : null,
        sourceFingerprint,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: [documentSearchShelves.organizationId, documentSearchShelves.shelfKey],
        set: { sourceFingerprint, syncedAt: now },
      })
  )
}

export async function markShelvesStale(organizationId: string, shelves: readonly DocumentShelf[]): Promise<void> {
  if (shelves.length === 0) return
  await withTenant({ organizationId }, () =>
    getDb()
      .update(documentSearchShelves)
      .set({
        sourceFingerprint: sql`CASE WHEN ${documentSearchShelves.syncedAt} IS NULL THEN NULL ELSE ${STALE_FINGERPRINT} END`,
        refreshRequestedAt: null,
      })
      .where(
        and(
          eq(documentSearchShelves.organizationId, organizationId),
          inArray(documentSearchShelves.shelfKey, shelves.map(shelfKey))
        )
      )
  )
}

export async function listCollectionDocumentsForProjection(
  organizationId: string,
  collectionName: string,
  filenames: readonly string[]
): Promise<ProjectionDocument[]> {
  if (filenames.length === 0) return []
  return withTenant({ organizationId }, () =>
    getDb()
      .select({
        id: documents.id,
        filename: documents.filename,
        collectionName: documents.collectionName,
        authoredBy: documents.authoredBy,
        publishedVersionId: documents.publishedVersionId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.collectionName, collectionName),
          inArray(documents.filename, [...filenames])
        )
      )
      .limit(PROJECTION_PAGE_SIZE)
  ) as Promise<ProjectionDocument[]>
}
