import 'server-only'
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { OFFICE_SHELF, projectShelf, shelfFolderWhere, type DocumentShelf } from '../shelf'
import { documents } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { documentVisibleTo, type DocumentReader } from '../visibility'
import { outsideHiddenFolders } from './list'

export async function findFolderPathsInProject(
  folderIds: readonly string[],
  projectId: string,
  organizationId: string,
): Promise<Map<string, string>> {
  if (folderIds.length === 0) return new Map()
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: projectFolders.id, path: projectFolders.path })
      .from(projectFolders)
      .where(
        and(
          inArray(projectFolders.id, [...folderIds]),
          eq(projectFolders.projectId, projectId),
          isNull(projectFolders.deletedAt),
        ),
      ),
  )
  return new Map(rows.map((row) => [row.id, row.path]))
}

async function findFolderPathOnShelf(
  shelf: DocumentShelf,
  folderId: string,
  organizationId: string,
): Promise<string | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ path: projectFolders.path })
      .from(projectFolders)
      .where(and(eq(projectFolders.id, folderId), shelfFolderWhere(shelf, organizationId)))
      .limit(1),
  )
  return row?.path ?? null
}

export function findFolderPathInProject(
  folderId: string,
  projectId: string,
  organizationId: string,
): Promise<string | null> {
  return findFolderPathOnShelf(projectShelf(projectId), folderId, organizationId)
}

export function findFolderPathInOfficeShelf(folderId: string, organizationId: string): Promise<string | null> {
  return findFolderPathOnShelf(OFFICE_SHELF, folderId, organizationId)
}

export async function countDocumentsByProject(
  organizationId: string,
  projectIds: string[],
  hiddenFolderIds: readonly string[] | undefined,
  reader: DocumentReader,
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {}
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ projectId: documents.projectId, total: count() })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          inArray(documents.projectId, projectIds),
          eq(documents.scope, 'project'),
          ...outsideHiddenFolders(hiddenFolderIds),
          documentVisibleTo(reader),
        ),
      )
      .groupBy(documents.projectId),
  )
  return Object.fromEntries(rows.map((row) => [row.projectId, Number(row.total)]))
}
