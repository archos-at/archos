import 'server-only'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { isUuid } from '@/lib/ids'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import { salvageProjectProfile } from '@/lib/project-profile/salvage'
import { withOptionalTenant, withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { DELETION_LIFECYCLE, deletionQueue } from '@/lib/db/schema/deletion-queue'
import { projectIntakes } from '@/lib/db/schema/project-intakes'
import { projects, type Project } from '@/lib/db/schema/projects'
import type { GeocodeResult } from '@/lib/geocoding/types'
import type { DbTransaction } from '@/lib/storage/repository'
import { publishProjectChanged, publishProjectListChanged } from '@/lib/realtime/door-events'
import type { ProjectOutcome, ProjectStatus } from './project-status'

function announceProject(organizationId: string, projectId: string, { listed = false } = {}): void {
  publishProjectChanged(organizationId, projectId)
  if (listed) publishProjectListChanged(organizationId)
}

export const PROJECT_LIST_LIMIT = 500

export async function listProjectsInOrg(
  organizationId: string,
  {
    limit = PROJECT_LIST_LIMIT,
    order = 'newest',
  }: { limit?: number; order?: 'newest' | 'oldest' } = {}
): Promise<Project[]> {
  const boundedLimit = Math.min(Math.max(1, Math.trunc(limit)), PROJECT_LIST_LIMIT)
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), isNull(projects.deletedAt)))
      .orderBy(order === 'oldest' ? asc(projects.createdAt) : desc(projects.createdAt))
      .limit(boundedLimit)
  )
}

export async function listProjectNamesInOrg(
  organizationId: string,
  projectIds: readonly string[]
): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map()
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(
        and(eq(projects.organizationId, organizationId), isNull(projects.deletedAt), inArray(projects.id, [...projectIds]))
      )
  )
  return new Map(rows.map((row) => [row.id, row.name]))
}

export async function findProjectInOrg(
  projectId: string,
  organizationId: string,
  options: { includeDeleted?: boolean } = {}
): Promise<Project | null> {
  const db = getDb()
  const conditions = [eq(projects.id, projectId), eq(projects.organizationId, organizationId)]
  if (!options.includeDeleted) conditions.push(isNull(projects.deletedAt))
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(projects)
      .where(and(...conditions))
      .limit(1)
  )
  if (!row) return null
  return { ...row, profile: salvageProjectProfile(row.profile).profile ?? emptyProjectProfile() }
}

export async function findProjectTenancy(
  projectId: string
): Promise<Pick<Project, 'organizationId' | 'deletedAt' | 'status'> | null> {
  if (!isUuid(projectId)) return null
  const db = getDb()
  const [row] = await withPlatformAccess(
    'project tenancy probe: resolve the owning org before authorizing',
    () =>
      db
        .select({ organizationId: projects.organizationId, deletedAt: projects.deletedAt, status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)
  )
  return row ?? null
}

export type ProjectFactsRow = Pick<Project, 'id' | 'organizationId' | 'collectionName' | 'profile' | 'status'>

export async function listProjectFactsPage(afterId: string | null, limit: number): Promise<ProjectFactsRow[]> {
  const db = getDb()
  const rows = await withPlatformAccess(
    'project facts sync: copy every live project’s facts onto its vector-store points, across organizations',
    () =>
      db
        .select({
          id: projects.id,
          organizationId: projects.organizationId,
          collectionName: projects.collectionName,
          profile: projects.profile,
          status: projects.status,
        })
        .from(projects)
        .where(and(isNull(projects.deletedAt), afterId ? sql`${projects.id} > ${afterId}` : undefined))
        .orderBy(asc(projects.id))
        .limit(limit)
  )
  return rows.map((row) => ({ ...row, profile: salvageProjectProfile(row.profile).profile ?? emptyProjectProfile() }))
}

export type ProjectStatusWrite =
  | { status: 'active' }
  | { status: 'paused'; at: Date }
  | { status: 'closed'; at: Date; closedBy: string; outcome: ProjectOutcome; endedOn: string }

export async function setProjectStatusInOrg(
  projectId: string,
  organizationId: string,
  from: ProjectStatus,
  change: ProjectStatusWrite
): Promise<Project | null> {
  const db = getDb()
  const cleared = { pausedAt: null, closedAt: null, closedBy: null }
  const values =
    change.status === 'closed'
      ? {
          ...cleared,
          status: 'closed' as const,
          closedAt: change.at,
          closedBy: change.closedBy,
          closedOutcome: change.outcome,
          endedOn: change.endedOn,
        }
      : change.status === 'paused'
        ? { ...cleared, status: 'paused' as const, pausedAt: change.at }
        : { ...cleared, status: 'active' as const }
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(projects)
      .set(values)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          isNull(projects.deletedAt),
          eq(projects.status, from),
          change.status === 'closed'
            ? sql`(${projects.startedOn} IS NULL OR ${projects.startedOn} <= ${change.endedOn}::date)`
            : undefined
        )
      )
      .returning()
  )
  if (row) announceProject(organizationId, projectId, { listed: true })
  return row ?? null
}

export async function insertProject(values: {
  organizationId: string
  name: string
  createdBy: string
  collectionName: string
  startedOn?: string | null
}): Promise<Project> {
  const db = getDb()
  const [row] = await withTenant({ organizationId: values.organizationId }, () =>
    db.insert(projects).values(values).returning()
  )
  announceProject(values.organizationId, row.id, { listed: true })
  return row
}

export async function inProjectTransaction<T>(
  organizationId: string,
  work: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  const db = getDb()
  return withTenant({ organizationId }, () => db.transaction(work))
}

export interface ProjectAddressRow {
  id: string
  name: string
  status: ProjectStatus
  address: string | null
  location: GeocodeResult | null
}

export async function listProjectAddressesInOrg(organizationId: string): Promise<ProjectAddressRow[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        address: sql<string | null>`COALESCE(${projects.profile} #>> '{facts,site_address,value}', ${projects.profile} #>> '{facts,standort_adresse,value}', ${projects.profile} #>> '{assumptions,site_address,value}')`,
        location: projectIntakes.location,
      })
      .from(projects)
      .leftJoin(projectIntakes, eq(projectIntakes.projectId, projects.id))
      .where(
        and(
          eq(projects.organizationId, organizationId),
          isNull(projects.deletedAt),
          sql`(COALESCE(${projects.profile} #>> '{facts,site_address,value}', ${projects.profile} #>> '{facts,standort_adresse,value}', ${projects.profile} #>> '{assumptions,site_address,value}') IS NOT NULL OR ${projectIntakes.location} IS NOT NULL)`
        )
      )
      .orderBy(desc(projects.createdAt))
      .limit(PROJECT_LIST_LIMIT)
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    address: typeof row.address === 'string' ? row.address : null,
    location: row.location ?? null,
  }))
}

export async function setProjectWorkosResourceId(
  projectId: string,
  organizationId: string,
  workosResourceId: string
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(projects)
      .set({ workosResourceId })
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
  )
}

export async function deleteProjectRow(projectId: string, organizationId: string): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
  )
}

export async function renameProjectInOrg(
  projectId: string,
  organizationId: string,
  name: string
): Promise<Project | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(projects)
      .set({ name })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          isNull(projects.deletedAt)
        )
      )
      .returning()
  )
  if (row) announceProject(organizationId, projectId, { listed: true })
  return row ?? null
}

export async function softDeleteProjectAndEnqueue(
  project: Pick<Project, 'id' | 'name' | 'organizationId' | 'collectionName'>,
  requestedBy: string,
  purgeAfter: Date
): Promise<void> {
  const db = getDb()
  const now = new Date()
  await withTenant({ organizationId: project.organizationId }, () =>
    db.transaction(async (tx) => {
      await tx.update(projects).set({ deletedAt: now }).where(eq(projects.id, project.id))
      await tx
        .insert(deletionQueue)
        .values({
          entityType: 'project',
          entityId: project.id,
          displayName: project.name,
          organizationId: project.organizationId,
          requestedBy,
          purgeAfter,
          payload: { collectionName: project.collectionName },
        })
        .onConflictDoNothing()
    })
  )
  announceProject(project.organizationId, project.id, { listed: true })
}

export type ProjectProfileState = Pick<
  Project,
  'profile' | 'profileVersion' | 'profilePromptView' | 'profileDisplay' | 'profileUpdatedAt'
>

const profileColumns = {
  profile: projects.profile,
  profileVersion: projects.profileVersion,
  profilePromptView: projects.profilePromptView,
  profileDisplay: projects.profileDisplay,
  profileUpdatedAt: projects.profileUpdatedAt,
}

export async function findProjectProfileInOrg(
  projectId: string,
  organizationId: string
): Promise<ProjectProfileState | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select(profileColumns)
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          isNull(projects.deletedAt)
        )
      )
      .limit(1)
  )
  return row ?? null
}

export async function updateProjectProfileIfVersion(
  projectId: string,
  organizationId: string,
  expectedVersion: number,
  values: ProjectProfileState,
  inTransaction?: (tx: DbTransaction, saved: ProjectProfileState) => Promise<void>
): Promise<ProjectProfileState | null> {
  const db = getDb()
  const saved = await withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set(values)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.organizationId, organizationId),
            isNull(projects.deletedAt),
            eq(projects.profileVersion, expectedVersion)
          )
        )
        .returning(profileColumns)
      if (!row) return null
      if (inTransaction) await inTransaction(tx, row)
      return row
    })
  )
  if (saved) announceProject(organizationId, projectId)
  return saved
}

export async function lockProjectProfile(
  tx: DbTransaction,
  projectId: string
): Promise<Project['profile'] | null> {
  const [row] = await tx
    .select({ profile: projects.profile })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1)
    .for('update')
  return row ? salvageProjectProfile(row.profile).profile : null
}

export async function setProjectProfileSummaryInOrg(
  projectId: string,
  organizationId: string,
  summary: string,
  summaryLocale?: string
): Promise<void> {
  const db = getDb()
  const scope = and(
    eq(projects.id, projectId),
    eq(projects.organizationId, organizationId),
    isNull(projects.deletedAt)
  )
  await withTenant({ organizationId }, async () => {
    const [current] = await db
      .select({ profileDisplay: projects.profileDisplay })
      .from(projects)
      .where(scope)
      .limit(1)
    if (!current?.profileDisplay) return
    await db
      .update(projects)
      .set({ profileDisplay: { ...current.profileDisplay, summary, summaryLocale } })
      .where(scope)
  })
  announceProject(organizationId, projectId)
}

export async function findProjectWorkosResourceId(
  projectId: string,
  organizationId: string
): Promise<string | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ workosResourceId: projects.workosResourceId })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          isNull(projects.deletedAt)
        )
      )
      .limit(1)
  )
  return row?.workosResourceId ?? null
}

export async function restoreProjectIfPending(
  projectId: string,
  organizationId: string
): Promise<boolean> {
  const db = getDb()
  const restored = await withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      const [entry] = await tx
        .update(deletionQueue)
        .set({ status: 'restored' })
        .where(
          and(
            eq(deletionQueue.entityType, 'project'),
            eq(deletionQueue.entityId, projectId),
            eq(deletionQueue.organizationId, organizationId),
            inArray(deletionQueue.status, DELETION_LIFECYCLE.sourcesOf('restore')),
            isNull(deletionQueue.claimedAt)
          )
        )
        .returning()

      if (!entry) return false

      await tx
        .update(projects)
        .set({ deletedAt: null })
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      return true
    })
  )
  if (restored) announceProject(organizationId, projectId, { listed: true })
  return restored
}

export async function findProjectPromptView(
  projectId: string,
  organizationId: string | null | undefined
): Promise<string | null> {
  const db = getDb()
  const conditions = [eq(projects.id, projectId)]
  if (organizationId) conditions.push(eq(projects.organizationId, organizationId))
  const [row] = await withOptionalTenant(
    organizationId,
    'anonymous deployment: project prompt view requested without a session',
    () =>
      db
        .select({ profilePromptView: projects.profilePromptView })
        .from(projects)
        .where(and(...conditions))
        .limit(1)
  )
  return row?.profilePromptView ?? null
}

export async function findProjectProfile(
  projectId: string,
  organizationId: string | null | undefined
): Promise<Project['profile'] | null> {
  const db = getDb()
  const conditions = [eq(projects.id, projectId)]
  if (organizationId) conditions.push(eq(projects.organizationId, organizationId))
  const [row] = await withOptionalTenant(
    organizationId,
    'anonymous deployment: project jurisdiction requested without a session',
    () =>
      db
        .select({ profile: projects.profile })
        .from(projects)
        .where(and(...conditions))
        .limit(1)
  )
  return row ? salvageProjectProfile(row.profile).profile : null
}

export async function findProjectCollectionName(
  projectId: string,
  organizationId: string
): Promise<string | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ collectionName: projects.collectionName })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
  )
  return row?.collectionName ?? null
}

export async function findProjectIdByCollectionName(
  collectionName: string,
  organizationId: string
): Promise<string | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.collectionName, collectionName),
          eq(projects.organizationId, organizationId)
        )
      )
      .limit(1)
  )
  return row?.id ?? null
}
