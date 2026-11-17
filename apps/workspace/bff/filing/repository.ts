import 'server-only'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents, type Document } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { withTenant } from '@/lib/db/tenant-context'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { shelfDocumentWhere, shelfFolderWhere, type DocumentShelf } from '@/lib/documents/shelf'
import { documentVisibleTo } from '@/lib/documents/visibility'

export const MAX_CONVENTION_FOLDERS = 3000

export const MAX_FILED_SAMPLE = 300

export interface OfficeFolderRow {
  id: string
  projectId: string
  parentId: string | null
  path: string
  description: string | null
  accessMode: 'inherit' | 'custom'
}

export async function listProjectsFolders(
  organizationId: string,
  projectIds: readonly string[]
): Promise<OfficeFolderRow[]> {
  if (projectIds.length === 0) return []
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({
        id: projectFolders.id,
        projectId: projectFolders.projectId,
        parentId: projectFolders.parentId,
        path: projectFolders.path,
        description: projectFolders.description,
        accessMode: projectFolders.accessMode,
      })
      .from(projectFolders)
      .where(
        and(
          eq(projectFolders.organizationId, organizationId),
          eq(projectFolders.scope, 'project'),
          inArray(projectFolders.projectId, [...projectIds]),
          isNull(projectFolders.deletedAt)
        )
      )
      .orderBy(projectFolders.path)
      .limit(MAX_CONVENTION_FOLDERS)
  )
  return rows.flatMap((row) => (row.projectId ? [{ ...row, projectId: row.projectId }] : []))
}

export const MAX_DESCRIBED_FOLDERS = 120

export interface DescribedFolderRow {
  id: string
  scope: 'project' | 'office_shelf'
  path: string
  description: string
}

export async function listDescribedFolders(
  organizationId: string,
  projectId: string | null
): Promise<DescribedFolderRow[]> {
  const read = (where: ReturnType<typeof and>) =>
    withTenant({ organizationId }, () =>
      getDb()
        .select({
          id: projectFolders.id,
          scope: projectFolders.scope,
          path: projectFolders.path,
          description: projectFolders.description,
        })
        .from(projectFolders)
        .where(and(eq(projectFolders.organizationId, organizationId), isNull(projectFolders.deletedAt), isNotNull(projectFolders.description), where))
        .orderBy(projectFolders.path)
        .limit(MAX_DESCRIBED_FOLDERS)
    )
  const [project, officeShelf] = await Promise.all([
    projectId ? read(and(eq(projectFolders.scope, 'project'), eq(projectFolders.projectId, projectId))) : Promise.resolve([]),
    read(eq(projectFolders.scope, 'office_shelf')),
  ])
  return [...project, ...officeShelf].flatMap((row) => (row.description ? [{ ...row, description: row.description }] : []))
}

export async function listFiledDocuments(
  organizationId: string,
  shelf: DocumentShelf,
  reader: DocumentReader
): Promise<Document[]> {
  return withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(documents)
      .where(
        and(
          shelfDocumentWhere(shelf, organizationId),
          isNotNull(documents.folderId),
          eq(documents.status, 'completed'),
          documentVisibleTo(reader)
        )
      )
      .orderBy(desc(documents.createdAt))
      .limit(MAX_FILED_SAMPLE)
  )
}

export async function listRootDocuments(
  organizationId: string,
  shelf: DocumentShelf,
  reader: DocumentReader,
  limit: number
): Promise<Document[]> {
  return withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(documents)
      .where(and(shelfDocumentWhere(shelf, organizationId), isNull(documents.folderId), documentVisibleTo(reader)))
      .orderBy(documents.filename)
      .limit(limit)
  )
}

export async function findRootDocuments(
  organizationId: string,
  shelf: DocumentShelf,
  reader: DocumentReader,
  ids: readonly string[]
): Promise<Document[]> {
  if (ids.length === 0) return []
  return withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(documents)
      .where(
        and(
          shelfDocumentWhere(shelf, organizationId),
          isNull(documents.folderId),
          inArray(documents.id, [...ids]),
          documentVisibleTo(reader)
        )
      )
      .limit(ids.length)
  )
}

export const MAX_SHELF_FOLDER_PATHS = 5000

export async function listShelfFolderPaths(organizationId: string, shelf: DocumentShelf): Promise<string[]> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ path: projectFolders.path })
      .from(projectFolders)
      .where(shelfFolderWhere(shelf, organizationId))
      .limit(MAX_SHELF_FOLDER_PATHS)
  )
  return rows.map((row) => row.path)
}

export async function findShelfFolderPaths(
  organizationId: string,
  shelf: DocumentShelf,
  ids: readonly string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ id: projectFolders.id, path: projectFolders.path })
      .from(projectFolders)
      .where(and(shelfFolderWhere(shelf, organizationId), inArray(projectFolders.id, [...ids])))
      .limit(ids.length)
  )
  return new Map(rows.map((row) => [row.id, row.path]))
}
