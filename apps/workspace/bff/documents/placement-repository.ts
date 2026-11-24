import 'server-only'
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documents } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { PLACEMENT_REINGEST_MARKER } from './repository'

export interface PlacementRow {
  id: string
  folderId: string | null
  collectionName: string
  filename: string
  status: string
  errorMessage: string | null
  metadata: unknown
  updatedAt: Date
  authoredBy: (typeof documents.$inferSelect)['authoredBy']
  authoredByProducer: string | null
  publishedVersionId: string | null
  storageKey: string | null
  storageBucket: string | null
}

const placementColumns = {
  id: documents.id,
  folderId: documents.folderId,
  collectionName: documents.collectionName,
  filename: documents.filename,
  status: documents.status,
  errorMessage: documents.errorMessage,
  metadata: documents.metadata,
  updatedAt: documents.updatedAt,
  authoredBy: documents.authoredBy,
  authoredByProducer: documents.authoredByProducer,
  publishedVersionId: documents.publishedVersionId,
  storageKey: documents.storageKey,
  storageBucket: documents.storageBucket,
}

export const PLACEMENT_PAGE = 500

const marked = () => sql`${documents.metadata} ->> ${PLACEMENT_REINGEST_MARKER}::text IS NOT NULL`

export function awaitsPlacementReingest(row: Pick<PlacementRow, 'status' | 'metadata'>): boolean {
  if (row.status !== 'processing') return false
  const metadata = row.metadata
  return typeof metadata === 'object' && metadata !== null && PLACEMENT_REINGEST_MARKER in metadata
}

export async function listPlacementRows(
  organizationId: string,
  projectId: string,
  projectCollection: string,
  restrictedSubtree: readonly string[],
  afterId: string | null
): Promise<PlacementRow[]> {
  const db = getDb()
  const candidates = or(
    ne(documents.collectionName, projectCollection),
    ...(restrictedSubtree.length > 0 ? [inArray(documents.folderId, [...restrictedSubtree])] : [])
  )
  return withTenant({ organizationId }, () =>
    db
      .select(placementColumns)
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
          eq(documents.scope, 'project'),
          candidates,
          ...(afterId ? [gt(documents.id, afterId)] : [])
        )
      )
      .orderBy(asc(documents.id))
      .limit(PLACEMENT_PAGE)
  )
}

export async function repointPlacementRow(
  organizationId: string,
  row: PlacementRow,
  target: string,
  options: { reingest: boolean }
): Promise<boolean> {
  const db = getDb()
  const handOff = options.reingest
    ? {
        status: 'processing' as const,
        errorMessage: null,
        metadata: sql`(coalesce(${documents.metadata}, '{}'::jsonb) - 'ingestJobId' - 'bffJobId') || jsonb_build_object(${PLACEMENT_REINGEST_MARKER}::text, true)`,
      }
    : {}
  try {
    const updated = await withTenant({ organizationId }, () =>
      db
        .update(documents)
        .set({ collectionName: target, updatedAt: new Date(), ...handOff })
        .where(
          and(
            eq(documents.id, row.id),
            eq(documents.organizationId, organizationId),
            eq(documents.collectionName, row.collectionName),
            ...(awaitsPlacementReingest(row) ? [eq(documents.status, 'processing'), marked()] : [])
          )
        )
        .returning({ id: documents.id })
    )
    return updated.length > 0
  } catch (error) {
    console.warn(`[placement] could not move document ${row.id} to ${target}:`, error)
    return false
  }
}

export async function findPlacementFolderPath(
  organizationId: string,
  projectId: string,
  folderId: string | null
): Promise<string | null> {
  if (!folderId) return null
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ path: projectFolders.path })
      .from(projectFolders)
      .where(and(eq(projectFolders.id, folderId), eq(projectFolders.projectId, projectId), isNull(projectFolders.deletedAt)))
      .limit(1)
  )
  return row?.path ?? null
}

function awaitingInProject(organizationId: string, projectId: string) {
  return and(
    eq(documents.organizationId, organizationId),
    eq(documents.projectId, projectId),
    eq(documents.scope, 'project'),
    eq(documents.status, 'processing'),
    marked()
  )
}

export async function takeAwaitingPlacementReingest(
  organizationId: string,
  projectId: string,
  limit: number
): Promise<PlacementRow[]> {
  const db = getDb()
  const due = db
    .select({ id: documents.id })
    .from(documents)
    .where(awaitingInProject(organizationId, projectId))
    .orderBy(asc(documents.id))
    .limit(limit)
    .for('update', { skipLocked: true })
  return withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ metadata: sql`${documents.metadata} - ${PLACEMENT_REINGEST_MARKER}::text` })
      .where(and(inArray(documents.id, due), awaitingInProject(organizationId, projectId)))
      .returning(placementColumns)
  )
}

export async function tagAwaitingPlacementReingest(
  organizationId: string,
  projectId: string,
  jobId: string
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(documents)
      .set({ metadata: sql`${documents.metadata} || jsonb_build_object('bffJobId', ${jobId}::text)` })
      .where(awaitingInProject(organizationId, projectId))
  )
}
