import { officeMonth } from '@/lib/organizations/time-zone'
import 'server-only'
import { getWorkOS } from '@/lib/workos/client'
import { requireProjectAccess, type ProjectPermission } from '@/lib/authz/projects'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { hasPermission, ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { effectiveResourcePermissions } from '@/lib/authz/resource-check'
import { recordAuditEvent } from '@/lib/audit/service'
import { neutralizeCollaborationForProject } from '@/lib/collaboration/cleanup'
import {
  lastProjectActivityByUser,
  listConversationIdsForProject,
} from '@/lib/conversations/repository'
import { countDocumentsByProject } from '@/lib/documents/repository'
import { waitingMailCounts } from '@/lib/inbound-mail/waiting-counts'
import { endFollowsOfClosedProject, rearmParkedOneShots } from './status-effects'
import { computePurgeAfter, projectGraceDays } from '@/lib/deletion/policy'
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { ProjectMemoryConfidence, ProjectMemoryItem, ProjectMemoryKind } from '@/lib/db/schema/project-memory'
import type { Project } from '@/lib/db/schema/projects'
import { getProjectOverviewData, type ProjectOverviewReader } from './overview-query'
import {
  closingProblem,
  canTransition,
  invalidTransition,
  isProjectClosed,
  keptWhenClosed,
  openToOrganizationWhenClosed,
  type ProjectOutcome,
} from './project-status'
import { dateToMonth, isMonth, monthToDate, type Month } from './month'
import { isAgentSetup, type ProjectSetup } from './create-project-schema'
import { LEGACY_AGENT_SETUP } from './legacy-project-setup'
import { seedProjectSite, startProjectIntake } from './intake-seed'
import { undoHalfCreatedProject } from './project-creation-undo'
import type { GeocodeResult } from '@/lib/geocoding/types'
import { nextOffsetCursor, type OffsetPage } from '@/lib/api/offset-page'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { memberReader } from '@/lib/documents/visibility'
import { withServedEvidence } from './memory-evidence'
import { syncProjectFacts } from '@/lib/cross-project/project-facts-mirror'
import {
  clearanceOf,
  customFolderNames,
  getHiddenFolderIds,
  purgedFolderDates,
  readableFolderIdsFor,
} from '@/lib/authz/folder-access'
import {
  createProjectMemoryItem,
  deleteProjectMemoryItem,
  listProjectMemory,
  updateProjectMemoryItem,
  type CreateMemoryOptions,
} from './memory-service'
import {
  isRestrictedShelfNote,
  projectTopicsOf,
  renameProjectShelfTopic,
  resolveProjectTopicForWrite,
} from './memory-topics'
import { pageOfTopic } from '@/lib/memory-topics/page'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'
import {
  findProjectCollectionName,
  findProjectInOrg,
  insertProject,
  listProjectsInOrg,
  renameProjectInOrg,
  restoreProjectIfPending,
  setProjectStatusInOrg,
  setProjectWorkosResourceId,
  softDeleteProjectAndEnqueue,
  type ProjectProfileState,
  type ProjectStatusWrite,
} from './repository'
import { withOfficeTopic } from './office-memory-topics'

export async function listProjects(
  session: AuthorizedSession,
  order: 'newest' | 'oldest' = 'newest'
): Promise<Project[]> {
  return listProjectsHolding(session, ['project:view'], order)
}

export async function listChatProjects(
  session: AuthorizedSession,
  order: 'newest' | 'oldest' = 'newest'
): Promise<Project[]> {
  return listProjectsHolding(session, CHAT_PERMISSIONS, order)
}

export async function listChatProjectsAmong(session: AuthorizedSession, projectIds: readonly string[]): Promise<Project[]> {
  const rows = await Promise.all([...new Set(projectIds)].map((id) => findProjectInOrg(id, session.organizationId)))
  return projectsHolding(
    session,
    rows.filter((row): row is Project => row !== null),
    CHAT_PERMISSIONS
  )
}

async function listProjectsHolding(
  session: AuthorizedSession,
  permissions: readonly ProjectPermission[],
  order: 'newest' | 'oldest'
): Promise<Project[]> {
  const projects = await listProjectsInOrg(session.organizationId, { order })
  return projectsHolding(session, projects, permissions)
}

export async function projectsHolding<T extends Pick<Project, 'id' | 'status'>>(
  session: AuthorizedSession,
  projects: readonly T[],
  permissions: readonly ProjectPermission[] = ['project:view']
): Promise<T[]> {
  if (hasPermission(session, ORG_PERMISSIONS.projectsAdminister)) return [...projects]

  const holds = async (project: T): Promise<boolean> => {
    const closed = isProjectClosed(project)
    const asked = closed ? keptWhenClosed(permissions) : permissions
    if (asked.length === 0) return false
    if (closed && openToOrganizationWhenClosed(asked)) return true
    const effective = await effectiveResourcePermissions({
      organizationMembershipId: session.organizationMembershipId,
      organizationId: session.organizationId,
      resourceExternalId: project.id,
      resourceTypeSlug: 'project',
    })
    return asked.some((permission) => effective.has(permission))
  }
  const held = await Promise.all(projects.map(holds))
  return projects.filter((_, index) => held[index])
}

export async function getProjectsListData(
  session: AuthorizedSession,
  order: 'newest' | 'oldest' = 'newest'
): Promise<{
  projects: Project[]
  documentCounts: Record<string, number>
  viewerActivity: Record<string, string>
  mailWaiting: Record<string, number>
}> {
  const visible = await listProjects(session, order)
  const visibleIds = visible.map((project) => project.id)
  const hiddenFolderIds = (await Promise.all(visibleIds.map((id) => getHiddenFolderIds(session, id)))).flat()
  const readers = await Promise.all(visibleIds.map((projectId) => shelfReaderFor(session, { scope: 'project', projectId })))
  const reviewedProjectIds = visibleIds.filter((_, index) => readers[index].kind === 'reviewer')
  const [documentCounts, viewerActivity, mailWaiting] = await Promise.all([
    countDocumentsByProject(session.organizationId, visibleIds, hiddenFolderIds, {
      kind: 'projects',
      userId: session.userId,
      reviewedProjectIds,
    }),
    lastProjectActivityByUser(session.organizationId, session.userId, visibleIds),
    waitingMailCounts(session, visibleIds),
  ])
  return { projects: visible, documentCounts, viewerActivity, mailWaiting }
}

export interface ProjectClosing {
  outcome: ProjectOutcome
  endedOn: Month
  startedOn: Month | null
}

export interface CreateProjectInput {
  name: string
  closing?: ProjectClosing
  setup?: ProjectSetup
  description?: string
  location?: GeocodeResult
  address?: string
  federalState?: string
  country?: string
}

export async function createProject(
  session: AuthorizedSession,
  input: CreateProjectInput,
  request?: Request,
  now: Date = new Date()
): Promise<Project> {
  const closing = input.closing ? closingOrRefuse(input.closing, await officeMonth(session.organizationId, now)) : undefined
  const agentSetup = isAgentSetup(input.setup)
  const closeNow = closing && !agentSetup ? closing : undefined
  const workos = getWorkOS()

  const inserted = await insertProject({
    organizationId: session.organizationId,
    name: input.name,
    createdBy: session.userId,
    collectionName: `proj_${crypto.randomUUID()}`,
    ...(closing?.startedOn ? { startedOn: monthToDate(closing.startedOn) } : {}),
  })

  let project = inserted
  let seeded: ProjectProfileState | null = null
  try {
    const resource = await workos.authorization.createResource({
      resourceTypeSlug: 'project',
      externalId: inserted.id,
      organizationId: session.organizationId,
      name: input.name,
    })

    await setProjectWorkosResourceId(inserted.id, session.organizationId, resource.id)

    await workos.authorization.assignRole({
      organizationMembershipId: session.organizationMembershipId,
      resourceExternalId: inserted.id,
      resourceTypeSlug: 'project',
      roleSlug: 'project-admin',
    })

    if (agentSetup) {
      seeded = await startProjectIntake(
        session,
        inserted,
        {
          description: input.description,
          location: input.location,
          address: input.address,
          federalState: input.federalState,
          country: input.country,
          closing: closing && { outcome: closing.outcome, startedOn: closing.startedOn, endedOn: closing.endedOn },
        },
        now
      )
    } else {
      const { location, address, federalState, country } = input
      seeded = await seedProjectSite(session, inserted, { location, address, federalState, country }, now)
    }
    if (seeded) project = { ...inserted, ...seeded }
    if (closeNow) project = await closeNewProject(session, inserted.id, closeNow, now)
  } catch (error) {
    await undoHalfCreatedProject(inserted.id, session.organizationId)
    throw error
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.created',
    targetType: 'project',
    targetId: project.id,
    metadata: agentSetup ? { name: input.name, setup: LEGACY_AGENT_SETUP } : { name: input.name },
    request,
  })
  if (closeNow) {
    await recordAuditEvent({
      organizationId: session.organizationId,
      actor: { userId: session.userId, email: session.email },
      action: 'project.closed',
      targetType: 'project',
      targetId: project.id,
      metadata: { name: project.name, from: 'active', outcome: closeNow.outcome, endedOn: closeNow.endedOn },
      request,
    })
  }

  return project
}

function closingOrRefuse(closing: ProjectClosing, thisMonth: Month): ProjectClosing {
  if (closing.startedOn !== null && !isMonth(closing.startedOn)) {
    throw new BadRequestError('The Beginn must be a month, YYYY-MM.', { reason: 'invalid-month' })
  }
  endedOnOrRefuse(closing.endedOn, closing.startedOn, thisMonth)
  return closing
}

async function closeNewProject(
  session: AuthorizedSession,
  projectId: string,
  closing: ProjectClosing,
  now: Date
): Promise<Project> {
  const closed = await setProjectStatusInOrg(projectId, session.organizationId, 'active', {
    status: 'closed',
    at: now,
    closedBy: session.userId,
    outcome: closing.outcome,
    endedOn: monthToDate(closing.endedOn),
  })
  if (!closed) throw new Error('The project was created but could not be closed, so it was not kept.')
  return closed
}

export async function getProject(session: AuthorizedSession, projectId: string): Promise<Project> {
  await requireProjectAccess(session, projectId, 'project:view')
  const project = await findProjectInOrg(projectId, session.organizationId)
  if (!project) throw new NotFoundError()
  return project
}

export async function updateProjectName(
  session: AuthorizedSession,
  projectId: string,
  name: string
): Promise<Project> {
  await requireProjectAccess(session, projectId, 'project:manage')
  const project = await renameProjectInOrg(projectId, session.organizationId, name)
  if (!project) throw new NotFoundError()
  return project
}

export async function deleteProject(
  session: AuthorizedSession,
  projectId: string,
  confirmName: string,
  request: Request
): Promise<{ purgeAfter: Date }> {
  await requireProjectAccess(session, projectId, 'project:manage', { evenWhenClosed: true })

  const project = await findProjectInOrg(projectId, session.organizationId)
  if (!project) throw new NotFoundError()
  if (confirmName !== project.name) {
    throw new BadRequestError('Project name does not match.')
  }

  const purgeAfter = computePurgeAfter(new Date(), projectGraceDays())
  await softDeleteProjectAndEnqueue(project, session.userId, purgeAfter)

  try {
    const conversationIds = await listConversationIdsForProject(projectId, session.organizationId)
    await neutralizeCollaborationForProject(session.organizationId, projectId, conversationIds)
  } catch (error) {
    console.warn('[projects] collaboration neutralization on project delete failed:', error)
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.deleted',
    targetType: 'project',
    targetId: projectId,
    metadata: { name: project.name, purgeAfter: purgeAfter.toISOString() },
    request,
  })

  return { purgeAfter }
}

export type ProjectStatusChange =
  | { status: 'active' }
  | { status: 'paused' }
  | { status: 'closed'; outcome: ProjectOutcome; endedOn: Month }

export async function setProjectStatus(
  session: AuthorizedSession,
  projectId: string,
  change: ProjectStatusChange,
  request?: Request,
  now: Date = new Date()
): Promise<Project> {
  await requireProjectAccess(session, projectId, 'project:manage', { evenWhenClosed: true })
  const current = await findProjectInOrg(projectId, session.organizationId)
  if (!current) throw new NotFoundError()
  const from = current.status
  if (!canTransition(from, change.status)) {
    throw new ConflictError(`A ${from} project cannot become ${change.status}.`, invalidTransition(from, change.status))
  }

  const write: ProjectStatusWrite =
    change.status === 'closed'
      ? {
          status: 'closed',
          at: now,
          closedBy: session.userId,
          outcome: change.outcome,
          endedOn: monthToDate(endedOnOrRefuse(change.endedOn, dateToMonth(current.startedOn), await officeMonth(session.organizationId, now))),
        }
      : change.status === 'paused'
        ? { status: 'paused', at: now }
        : { status: 'active' }
  const project = await setProjectStatusInOrg(projectId, session.organizationId, from, write)
  if (!project) {
    throw new ConflictError('The project changed meanwhile.', invalidTransition(from, change.status))
  }
  if (change.status === 'active') await rearmParkedOneShots(projectId, session.organizationId)
  if (change.status === 'closed') await endFollowsOfClosedProject(session, projectId, now)
  await syncProjectFacts(session.organizationId, projectId)

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action:
      change.status === 'closed'
        ? 'project.closed'
        : change.status === 'paused'
          ? 'project.paused'
          : from === 'closed'
            ? 'project.reopened'
            : 'project.resumed',
    targetType: 'project',
    targetId: projectId,
    metadata:
      change.status === 'closed'
        ? { name: project.name, from, outcome: change.outcome, endedOn: change.endedOn }
        : { name: project.name, from },
    request,
  })
  return project
}

function endedOnOrRefuse(endedOn: Month, startedOn: Month | null, thisMonth: Month): Month {
  const problem = closingProblem(endedOn, startedOn, thisMonth)
  if (problem === 'invalid') {
    throw new BadRequestError('The Abschluss must be a month, YYYY-MM.', { reason: 'invalid-month' })
  }
  if (problem === 'future') {
    throw new BadRequestError('The Abschluss cannot lie in the future.', { reason: 'abschluss-in-future' })
  }
  if (problem === 'beforeStart') {
    throw new BadRequestError('The Abschluss cannot lie before the Beginn.', { reason: 'abschluss-before-beginn' })
  }
  return endedOn
}

export async function restoreProject(
  session: AuthorizedSession,
  projectId: string,
  request: Request
): Promise<void> {
  await requireProjectAccess(session, projectId, 'project:manage', { includeDeleted: true, evenWhenClosed: true })

  const restored = await restoreProjectIfPending(projectId, session.organizationId)
  if (!restored) {
    throw new ConflictError(
      'No pending deletion to restore (already purged, or purge in progress).'
    )
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.restored',
    targetType: 'project',
    targetId: projectId,
    request,
  })
}

export async function projectOverviewReader(
  session: AuthorizedSession,
  projectId: string
): Promise<ProjectOverviewReader> {
  return {
    hiddenFolderIds: await getHiddenFolderIds(session, projectId),
    reader: await shelfReaderFor(session, { scope: 'project', projectId }),
  }
}

export async function getProjectOverview(session: AuthorizedSession, projectId: string) {
  await requireProjectAccess(session, projectId, 'project:view')
  const reader = await projectOverviewReader(session, projectId)
  const data = await getProjectOverviewData(projectId, session.organizationId, reader)
  if (!data) throw new NotFoundError('Project not found')
  return data
}


export type ProjectMemoryItemPatch = Partial<
  Pick<ProjectMemoryItem, 'content' | 'kind' | 'status' | 'confidence' | 'verification' | 'pinned' | 'topic'>
>

export type ProjectMemoryListItem = ProjectMemoryItem & {
  restrictedFolderNames?: string[]
  sourceDeletedAt?: string
}

export async function memoryClearance(
  session: AuthorizedSession,
  projectId: string
): Promise<{ cleared: readonly string[] }> {
  const projectCollection = await findProjectCollectionName(projectId, session.organizationId)
  if (!projectCollection) return { cleared: [] }
  return { cleared: await readableFolderIdsFor(session.organizationId, projectId, await clearanceOf(session, projectId)) }
}

async function labelRestrictions(
  session: AuthorizedSession,
  projectId: string,
  items: ProjectMemoryItem[]
): Promise<ProjectMemoryListItem[]> {
  if (!items.some((item) => (item.restrictedFolderIds?.length ?? 0) > 0)) return items
  const [names, purgedAt] = await Promise.all([
    customFolderNames(session.organizationId, projectId),
    purgedFolderDates(session.organizationId, projectId),
  ])
  return items.map((item) => {
    if (!item.restrictedFolderIds || item.restrictedFolderIds.length === 0) return item
    const deleted = item.restrictedFolderIds
      .flatMap((folderId) => {
        const at = purgedAt.get(folderId)
        return at ? [at.toISOString()] : []
      })
      .sort()
    return {
      ...item,
      restrictedFolderNames: item.restrictedFolderIds
        .map((folderId) => names.get(folderId))
        .filter((name): name is string => name !== undefined),
      ...(deleted.length > 0 ? { sourceDeletedAt: deleted[0] } : {}),
    }
  })
}

export async function getProjectMemory(
  session: AuthorizedSession,
  projectId: string,
  options: { includeArchived?: boolean; sourceConversationId?: string } = {}
): Promise<ProjectMemoryListItem[]> {
  return (await getProjectMemoryPage(session, projectId, options)).items
}

type MemoryListOptions = { includeArchived?: boolean; sourceConversationId?: string; page?: OffsetPage }

type MemoryShelf = { items: ProjectMemoryListItem[]; nextCursor: string | null; topics: MemoryTopicCount[] }

export async function getProjectMemoryPage(
  session: AuthorizedSession,
  projectId: string,
  options: MemoryListOptions = {}
): Promise<{ items: ProjectMemoryListItem[]; nextCursor: string | null }> {
  await requireProjectAccess(session, projectId, 'project:view')
  const { cleared } = await memoryClearance(session, projectId)
  return memoryPageFor(session, projectId, cleared, options)
}

export async function getProjectMemoryShelf(
  session: AuthorizedSession,
  projectId: string,
  options: MemoryListOptions & { page: OffsetPage; topic?: string }
): Promise<MemoryShelf> {
  await requireProjectAccess(session, projectId, 'project:view')
  const { cleared } = await memoryClearance(session, projectId)
  const { topic, page, ...scope } = options
  const listed =
    topic === undefined
      ? await memoryPageFor(session, projectId, cleared, { ...scope, page })
      : pageOfTopic((await memoryPageFor(session, projectId, cleared, scope)).items, topic, page)
  return { ...listed, topics: await projectTopicsOf(projectId, session.organizationId, cleared) }
}

async function memoryPageFor(
  session: AuthorizedSession,
  projectId: string,
  cleared: readonly string[],
  options: MemoryListOptions
): Promise<{ items: ProjectMemoryListItem[]; nextCursor: string | null }> {
  const fetched = await listProjectMemory(projectId, {
    ...options,
    organizationId: session.organizationId,
    readableFolderIds: cleared,
  })
  const nextCursor = options.page ? nextOffsetCursor(options.page, fetched.length) : null
  const listed = options.page ? fetched.slice(0, options.page.limit) : fetched
  const items = await withServedEvidence(session.organizationId, listed, {
    reader: memberReader(session.userId),
    clearanceIn: () => cleared,
  })
  return { items: await labelRestrictions(session, projectId, items), nextCursor }
}

export const MEMORY_WRITE_PERMISSIONS: readonly ProjectPermission[] = ['project:memory:write', 'project:edit']

export interface PersonMemoryInput {
  kind: ProjectMemoryKind
  content: string
  confidence?: ProjectMemoryConfidence
  pinned?: boolean
  topic?: string | null
  sourceConversationId?: string | null
}

const personNote = (session: AuthorizedSession, input: PersonMemoryInput) => ({
  organizationId: session.organizationId,
  kind: input.kind,
  content: input.content,
  confidence: input.confidence ?? 'medium',
  pinned: input.pinned ?? false,
  provenanceType: 'user' as const,
  verification: 'user_confirmed' as const,
  createdBy: session.userId,
  ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
  ...(input.topic === undefined ? {} : { topic: input.topic }),
})

export async function addProjectMemoryItem(
  session: AuthorizedSession,
  projectId: string,
  input: PersonMemoryInput,
  options: Pick<CreateMemoryOptions, 'supersedesContent'> = {}
): Promise<ProjectMemoryItem> {
  await requireProjectAccess(session, projectId, MEMORY_WRITE_PERMISSIONS)
  const topic = await resolveWriteTopic(projectId, session.organizationId, input.topic)
  return createProjectMemoryItem(
    { scope: 'project', projectId, ...personNote(session, { ...input, topic }) },
    options
  )
}

async function resolveWriteTopic(
  projectId: string,
  organizationId: string,
  raw: string | null | undefined,
  readable: readonly string[] = []
): Promise<string | null | undefined> {
  return raw === undefined ? undefined : resolveProjectTopicForWrite(projectId, organizationId, raw, readable)
}

export async function createOrganizationMemoryItem(
  session: AuthorizedSession,
  input: PersonMemoryInput,
  options: Pick<CreateMemoryOptions, 'supersedesContent'> = {}
): Promise<ProjectMemoryItem> {
  const resolved = await withOfficeTopic(session.organizationId, input)
  return createProjectMemoryItem({ scope: 'organization', projectId: null, ...personNote(session, resolved) }, options)
}

export async function editProjectMemoryItem(
  session: AuthorizedSession,
  projectId: string,
  itemId: string,
  patch: ProjectMemoryItemPatch
): Promise<ProjectMemoryItem> {
  await requireProjectAccess(session, projectId, ['project:memory:write', 'project:edit'])
  const { cleared } = await memoryClearance(session, projectId)
  const restricted =
    patch.topic !== undefined &&
    (await isRestrictedShelfNote(projectId, session.organizationId, itemId, cleared))
  const writable = restricted ? cleared : []
  const topic = await resolveWriteTopic(projectId, session.organizationId, patch.topic, writable)
  const item = await updateProjectMemoryItem(
    { projectId, organizationId: session.organizationId, readableFolderIds: cleared },
    itemId,
    { ...patch, ...(topic === undefined ? {} : { topic }) }
  )
  if (!item) throw new NotFoundError()
  return item
}

export async function renameProjectMemoryTopic(
  session: AuthorizedSession,
  projectId: string,
  input: { from: string | null; to: string | null }
): Promise<{ moved: number }> {
  await requireProjectAccess(session, projectId, MEMORY_WRITE_PERMISSIONS)
  const { cleared } = await memoryClearance(session, projectId)
  return renameProjectShelfTopic({ projectId, organizationId: session.organizationId, readable: cleared, ...input })
}

export async function removeProjectMemoryItem(
  session: AuthorizedSession,
  projectId: string,
  itemId: string
): Promise<void> {
  await requireProjectAccess(session, projectId, ['project:memory:write', 'project:edit'])
  const { cleared } = await memoryClearance(session, projectId)
  const deleted = await deleteProjectMemoryItem(
    { projectId, organizationId: session.organizationId, readableFolderIds: cleared },
    itemId
  )
  if (!deleted) throw new NotFoundError()
}
