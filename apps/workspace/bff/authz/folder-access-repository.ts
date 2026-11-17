import 'server-only'
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { documents } from '@/lib/db/schema/documents'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { projects } from '@/lib/db/schema/projects'
import { IFC_EXTENSIONS } from '@/lib/bim/types'
import { getDeletedFolderContentPolicy } from '@/lib/organizations/deleted-folder-content'
import type { AccessFolder } from './folder-access'

export async function projectHasCustomFolders(organizationId: string, projectId: string): Promise<boolean> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: projectFolders.id })
      .from(projectFolders)
      .innerJoin(projects, eq(projects.id, projectFolders.projectId))
      .where(
        and(
          eq(projectFolders.projectId, projectId),
          eq(projects.organizationId, organizationId),
          eq(projectFolders.accessMode, 'custom')
        )
      )
      .limit(1)
  )
  return rows.length > 0
}

export async function projectHasCustomOrBinnedFolders(organizationId: string, projectId: string): Promise<boolean> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: projectFolders.id })
      .from(projectFolders)
      .innerJoin(projects, eq(projects.id, projectFolders.projectId))
      .where(
        and(
          eq(projectFolders.projectId, projectId),
          eq(projects.organizationId, organizationId),
          or(
            eq(projectFolders.accessMode, 'custom'),
            and(isNotNull(projectFolders.deletedAt), isNull(projectFolders.purgedAt))
          )
        )
      )
      .limit(1)
  )
  return rows.length > 0
}

export const RESTRICTED_PROJECTS_LIMIT = 1_000

export async function listProjectsWithCustomOrBinnedFolders(organizationId: string): Promise<string[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .selectDistinct({ projectId: projectFolders.projectId })
      .from(projectFolders)
      .innerJoin(projects, eq(projects.id, projectFolders.projectId))
      .where(
        and(
          eq(projects.organizationId, organizationId),
          or(
            eq(projectFolders.accessMode, 'custom'),
            and(isNotNull(projectFolders.deletedAt), isNull(projectFolders.purgedAt))
          )
        )
      )
      .limit(RESTRICTED_PROJECTS_LIMIT)
  )
  return rows.flatMap((row) => (row.projectId ? [row.projectId] : []))
}

export async function listProjectFolderTree(organizationId: string, projectId: string): Promise<AccessFolder[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        id: projectFolders.id,
        parentId: projectFolders.parentId,
        accessMode: projectFolders.accessMode,
        everyoneReads: projectFolders.everyoneReads,
        deletedAt: projectFolders.deletedAt,
        purgedAt: projectFolders.purgedAt,
      })
      .from(projectFolders)
      .innerJoin(projects, eq(projects.id, projectFolders.projectId))
      .where(and(eq(projectFolders.projectId, projectId), eq(projects.organizationId, organizationId)))
  )
  const purgedContent = rows.some((row) => row.purgedAt !== null)
    ? await getDeletedFolderContentPolicy(organizationId)
    : undefined
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    accessMode: row.accessMode,
    everyoneReads: row.accessMode === 'custom' && row.everyoneReads,
    deleted: row.deletedAt !== null,
    ...(row.purgedAt !== null ? { purgedAt: new Date(row.purgedAt), purgedContent } : {}),
  }))
}

export async function listCustomFolderNames(
  organizationId: string,
  projectId: string
): Promise<Array<{ id: string; name: string }>> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select({ id: projectFolders.id, name: projectFolders.name })
      .from(projectFolders)
      .innerJoin(projects, eq(projects.id, projectFolders.projectId))
      .where(
        and(
          eq(projectFolders.projectId, projectId),
          eq(projects.organizationId, organizationId),
          eq(projectFolders.accessMode, 'custom')
        )
      )
      .limit(500)
  )
}

export async function listProjectDocumentCollections(organizationId: string, projectId: string): Promise<string[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .selectDistinct({ collectionName: documents.collectionName })
      .from(documents)
      .where(and(eq(documents.projectId, projectId), eq(documents.organizationId, organizationId)))
  )
  return rows.map((row) => row.collectionName)
}

export interface RestrictedProjectsPage {
  after: string | null
  upTo: string | null
  limit: number
}

export async function countIfcDocumentsInFolders(
  organizationId: string,
  projectId: string,
  folderIds: readonly string[]
): Promise<number> {
  if (folderIds.length === 0) return 0
  const db = getDb()
  const isIfc = or(...IFC_EXTENSIONS.map((ext) => sql`lower(btrim(${documents.filename})) LIKE ${`%${ext}`}`))
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ total: count() })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.projectId, projectId),
          eq(documents.scope, 'project'),
          inArray(documents.folderId, [...folderIds]),
          isIfc
        )
      )
  )
  return Number(row?.total ?? 0)
}

export async function listProjectsWithRestrictedFolders(
  page: RestrictedProjectsPage
): Promise<Array<{ organizationId: string; projectId: string }>> {
  const db = getDb()
  return db
    .selectDistinct({ organizationId: projects.organizationId, projectId: projects.id })
    .from(projectFolders)
    .innerJoin(projects, eq(projects.id, projectFolders.projectId))
    .where(
      and(
        eq(projectFolders.accessMode, 'custom'),
        isNull(projectFolders.deletedAt),
        ...(page.after ? [gt(projects.id, page.after)] : []),
        ...(page.upTo ? [lte(projects.id, page.upTo)] : [])
      )
    )
    .orderBy(asc(projects.id))
    .limit(page.limit)
}
