import { and, eq, inArray, isNotNull, isNull, notInArray, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { outsideHiddenFolders } from '@/lib/documents/repository'
import { documentVisibleTo, internalRead, type DocumentReader } from '@/lib/documents/visibility'
import { documentRoles } from '@/lib/db/schema/document-roles'
import { documents } from '@/lib/db/schema/documents'
import type { DbTransaction } from '@/lib/storage/repository'
import type { DocumentRole, RoleConfidence, RoleSource } from '@/lib/project-profile/document-roles'
import { legacyBuildingId, normalizeBuildingId } from '@/lib/project-profile/legacy-names'

export interface DocumentRoleBinding {
  id: string
  projectId: string
  documentId: string
  role: DocumentRole
  scopeInstanceId: string | null
  confidence: RoleConfidence
  source: RoleSource
  createdBy: string
  createdAt: Date
  filename: string
  displayName: string | null
}

interface RoleRowShape {
  id: string
  projectId: string
  documentId: string
  role: string
  scopeInstanceId: string | null
  confidence: string
  source: string
  createdBy: string
  createdAt: Date
  filename: string
  displayName: string | null
}

function toBinding(row: RoleRowShape): DocumentRoleBinding {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    role: row.role as DocumentRole,
    scopeInstanceId: row.scopeInstanceId === null ? null : normalizeBuildingId(row.scopeInstanceId),
    confidence: row.confidence as RoleConfidence,
    source: row.source as RoleSource,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    filename: row.filename,
    displayName: row.displayName,
  }
}

const SELECTION = {
  id: documentRoles.id,
  projectId: documentRoles.projectId,
  documentId: documentRoles.documentId,
  role: documentRoles.role,
  scopeInstanceId: documentRoles.scopeInstanceId,
  confidence: documentRoles.confidence,
  source: documentRoles.source,
  createdBy: documentRoles.createdBy,
  createdAt: documentRoles.createdAt,
  filename: documents.filename,
  displayName: documents.displayName,
} as const

export type DocumentRoleReader = ({ hiddenFolderIds: readonly string[] } | { unfiledOnly: true }) & {
  documents: DocumentReader
}

function visibleTo(reader: DocumentRoleReader): SQL[] {
  const held = documentVisibleTo(reader.documents)
  const folders = 'unfiledOnly' in reader ? [isNull(documents.folderId)] : outsideHiddenFolders(reader.hiddenFolderIds)
  return held ? [...folders, held] : folders
}

export async function listProjectDocumentRoles(
  projectId: string,
  reader: DocumentRoleReader
): Promise<DocumentRoleBinding[]> {
  const db = getDb()
  const rows = await db
    .select(SELECTION)
    .from(documentRoles)
    .innerJoin(documents, eq(documents.id, documentRoles.documentId))
    .where(and(eq(documentRoles.projectId, projectId), ...visibleTo(reader)))
    .orderBy(documentRoles.role, documentRoles.createdAt)
  return rows.map(toBinding)
}

export async function findBindingsForRole(
  projectId: string,
  role: DocumentRole,
  scopeInstanceId: string | null
): Promise<DocumentRoleBinding[]> {
  const db = getDb()
  const rows = await db
    .select(SELECTION)
    .from(documentRoles)
    .innerJoin(documents, eq(documents.id, documentRoles.documentId))
    .where(
      and(
        eq(documentRoles.projectId, projectId),
        eq(documentRoles.role, role),
        scopeInstanceId === null
          ? isNull(documentRoles.scopeInstanceId)
          : inArray(documentRoles.scopeInstanceId, [scopeInstanceId, legacyBuildingId(scopeInstanceId)]),
        documentVisibleTo(internalRead('identity'))
      )
    )
    .orderBy(documentRoles.createdAt)
  return rows.map(toBinding)
}

export interface InsertBindingInput {
  organizationId: string
  projectId: string
  documentId: string
  role: DocumentRole
  scopeInstanceId: string | null
  confidence: RoleConfidence
  source: RoleSource
  createdBy: string
}

export async function insertBinding(input: InsertBindingInput): Promise<string> {
  const db = getDb()
  const [inserted] = await db
    .insert(documentRoles)
    .values(input)
    .returning({ id: documentRoles.id })
  return inserted.id
}

export async function replaceSlotBinding(
  input: InsertBindingInput,
  displacedIds: readonly string[],
  guard?: (tx: DbTransaction) => Promise<void>
): Promise<string> {
  const db = getDb()
  return db.transaction(async (tx) => {
    if (guard) await guard(tx)
    if (displacedIds.length > 0) {
      await tx
        .delete(documentRoles)
        .where(
          and(
            eq(documentRoles.projectId, input.projectId),
            inArray(documentRoles.id, [...displacedIds])
          )
        )
    }
    const [inserted] = await tx
      .insert(documentRoles)
      .values(input)
      .returning({ id: documentRoles.id })
    return inserted.id
  })
}

export async function confirmBinding(
  projectId: string,
  bindingId: string,
  confidence: RoleConfidence,
  source: RoleSource
): Promise<void> {
  const db = getDb()
  await db
    .update(documentRoles)
    .set({ confidence, source, updatedAt: new Date() })
    .where(and(eq(documentRoles.projectId, projectId), eq(documentRoles.id, bindingId)))
}

export async function deleteBindings(projectId: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0
  const db = getDb()
  const removed = await db
    .delete(documentRoles)
    .where(and(eq(documentRoles.projectId, projectId), inArray(documentRoles.id, ids)))
    .returning({ id: documentRoles.id })
  return removed.length
}

export async function deleteBindingsOutsideBuildings(
  projectId: string,
  keep: readonly string[],
  tx: DbTransaction
): Promise<number> {
  const kept = [...new Set(keep.flatMap((id) => [id, legacyBuildingId(id)]))]
  const outside =
    keep.length > 0
      ? and(isNotNull(documentRoles.scopeInstanceId), notInArray(documentRoles.scopeInstanceId, kept))
      : isNotNull(documentRoles.scopeInstanceId)
  const removed = await tx
    .delete(documentRoles)
    .where(and(eq(documentRoles.projectId, projectId), outside))
    .returning({ id: documentRoles.id })
  return removed.length
}

export async function documentBelongsToProject(
  documentId: string,
  projectId: string,
  reader: DocumentRoleReader
): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.projectId, projectId),
        ...visibleTo(reader)
      )
    )
    .limit(1)
  return row !== undefined
}
