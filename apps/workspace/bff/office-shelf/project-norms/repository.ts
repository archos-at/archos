import 'server-only'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { officeShelfNormKeeps, officeShelfReferences, type OfficeShelfReference } from '@/lib/db/schema/office-shelf-references'
import { withTenant } from '@/lib/db/tenant-context'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'
import type { NormCandidateRow } from './placement'
import type { ReferencePlacement } from './wire'

export const MAX_LEVEL_NORM_ROWS = 500
export const MAX_LISTED_REFERENCES = 201

export type ProjectNormRow = NormCandidateRow & { createdBy: string }

const normRowColumns = {
  id: documents.id,
  filename: documents.filename,
  displayName: documents.displayName,
  folderId: documents.folderId,
  status: documents.status,
  authoredBy: documents.authoredBy,
  screenedHash: documents.screenedHash,
  contentHash: documents.contentHash,
  screeningOutcome: documents.screeningOutcome,
  createdBy: documents.createdBy,
}

export type NormRowsWhere = { folderId: string | null }

export async function listProjectNormRows(
  organizationId: string,
  projectId: string,
  where: NormRowsWhere,
  reader: DocumentReader
): Promise<ProjectNormRow[]> {
  const place = where.folderId === null ? isNull(documents.folderId) : eq(documents.folderId, where.folderId)
  return withTenant({ organizationId }, () =>
    getDb()
      .select(normRowColumns)
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'project'),
          eq(documents.projectId, projectId),
          eq(documents.authoredBy, 'user'),
          eq(documents.lifecycle, 'active'),
          place,
          documentVisibleTo(reader)
        )
      )
      .orderBy(desc(documents.createdAt))
      .limit(MAX_LEVEL_NORM_ROWS)
  )
}

export async function officeDocumentHashes(
  organizationId: string,
  documentIds: readonly string[],
  reader: DocumentReader
): Promise<Map<string, string | null>> {
  if (documentIds.length === 0) return new Map()
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ id: documents.id, contentHash: documents.contentHash })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.scope, 'office_shelf'),
          inArray(documents.id, [...documentIds]),
          documentVisibleTo(reader)
        )
      )
  )
  return new Map(rows.map((row) => [row.id, row.contentHash]))
}

export interface NewReference {
  organizationId: string
  projectId: string
  folderId: string | null
  sourceDocumentId: string
  officeDocumentId: string
  fileName: string
  placedAs: ReferencePlacement
  createdBy: string
}

export async function insertReference(input: NewReference): Promise<OfficeShelfReference> {
  return withTenant({ organizationId: input.organizationId }, async () => {
    const [row] = await getDb()
      .insert(officeShelfReferences)
      .values({ ...input, fileName: input.fileName.slice(0, 512) })
      .onConflictDoUpdate({
        target: [officeShelfReferences.projectId, officeShelfReferences.sourceDocumentId],
        set: { officeDocumentId: input.officeDocumentId, placedAs: input.placedAs },
      })
      .returning()
    return row
  })
}

export async function listReferences(
  organizationId: string,
  projectId: string,
  folderId: string | null,
  page: { offset: number; limit: number }
): Promise<OfficeShelfReference[]> {
  return withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(officeShelfReferences)
      .where(
        and(
          eq(officeShelfReferences.organizationId, organizationId),
          eq(officeShelfReferences.projectId, projectId),
          folderId === null ? isNull(officeShelfReferences.folderId) : eq(officeShelfReferences.folderId, folderId)
        )
      )
      .orderBy(desc(officeShelfReferences.createdAt), desc(officeShelfReferences.id))
      .offset(page.offset)
      .limit(Math.min(page.limit, MAX_LISTED_REFERENCES))
  )
}

export async function keepInProject(
  organizationId: string,
  projectId: string,
  documentIds: readonly string[],
  keptBy: string
): Promise<void> {
  if (documentIds.length === 0) return
  await withTenant({ organizationId }, () =>
    getDb()
      .insert(officeShelfNormKeeps)
      .values(documentIds.map((documentId) => ({ documentId, organizationId, projectId, keptBy })))
      .onConflictDoNothing()
  )
}

export async function keptAmong(organizationId: string, documentIds: readonly string[]): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ documentId: officeShelfNormKeeps.documentId })
      .from(officeShelfNormKeeps)
      .where(and(eq(officeShelfNormKeeps.organizationId, organizationId), inArray(officeShelfNormKeeps.documentId, [...documentIds])))
  )
  return new Set(rows.map((row) => row.documentId))
}
