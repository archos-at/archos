import { eq, and, desc, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { projects } from '@/lib/db/schema/projects'
import type { ProjectOverviewData } from '@/features/projects/types'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import { salvageProjectProfile } from '@/lib/project-profile/salvage'
import { outsideHiddenFolders } from '@/lib/documents/repository'
import { documentVisibleTo, type ShelfReader } from '@/lib/documents/visibility'
import { lifecycleViewOf } from './project-status'

export interface ProjectOverviewReader {
  hiddenFolderIds: readonly string[]
  reader: ShelfReader
}

export async function getProjectOverviewData(
  projectId: string,
  organizationId: string,
  { hiddenFolderIds, reader }: ProjectOverviewReader
): Promise<ProjectOverviewData | null> {
  const db = getDb()

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      collectionName: projects.collectionName,
      status: projects.status,
      pausedAt: projects.pausedAt,
      closedAt: projects.closedAt,
      closedOutcome: projects.closedOutcome,
      startedOn: projects.startedOn,
      endedOn: projects.endedOn,
      createdAt: projects.createdAt,
      profile: projects.profile,
      profileDisplay: projects.profileDisplay,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)

  if (!project) {
    return null
  }

  const [stats] = await db
    .select({
      count: sql<number>`count(*)::int`.as('count'),
      totalSize: sql<number>`coalesce(sum(${documents.fileSize}), 0)::bigint`.as('total_size'),
    })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        eq(documents.organizationId, organizationId),
        eq(documents.scope, 'project'),
        ...outsideHiddenFolders(hiddenFolderIds),
        documentVisibleTo(reader)
      )
    )

  const recentDocs = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      fileSize: documents.fileSize,
      contentType: documents.contentType,
      status: documents.status,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        eq(documents.organizationId, organizationId),
        eq(documents.scope, 'project'),
        ...outsideHiddenFolders(hiddenFolderIds),
        documentVisibleTo(reader)
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(5)

  const profile = salvageProjectProfile(project.profile).profile ?? emptyProjectProfile()

  return {
    id: project.id,
    name: project.name,
    collectionName: project.collectionName,
    status: project.status,
    lifecycle: lifecycleViewOf(project),
    createdAt: project.createdAt.toISOString(),
    profileDisplay: project.profileDisplay
      ? {
          ...project.profileDisplay,
          keyFacts: project.profileDisplay?.keyFacts ?? [],
        }
      : null,
    profile,
    documentCount: stats?.count ?? 0,
    totalFileSize: Number(stats?.totalSize) || 0,
    recentDocuments: recentDocs.map((d) => ({
      ...d,
      fileSize: d.fileSize,
    })),
  }
}
