import 'server-only'
import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { filterUsersWithProjectAccess } from '@/lib/authz/project-membership'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { findDocumentForSession } from '@/lib/documents/access'
import { mayOpenDocument, mayWriteDocument } from '@/lib/documents/may-open'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems } from '@/lib/inbox/service'
import { requireResourceAccess, requireResourceWriteAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory, unknownPerson } from '@/lib/sharing/directory'
import { describeResource } from '@/lib/sharing/registry'
import type { DirectoryPerson } from '@/lib/sharing/types'
import {
  deleteAssignment,
  insertAssignment,
  listAssignmentsForResources,
} from './repository'

export interface AssignedPerson extends DirectoryPerson {
  assignedBy: string
}

export async function listAssignmentCandidates(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  options: { access?: CandidateAccess } = {},
): Promise<DirectoryPerson[]> {
  if (!isCollaborationEnabled(session)) {
    throw new NotFoundError()
  }
  const needed = options.access ?? 'read'
  if (needed === 'write' && resourceType !== 'document') {
    throw new BadRequestError('Only a document lists who may write it.')
  }
  const access = await requireResourceAccess(session, resourceType, resourceId, 'collaborator')
  const directory = await loadOrganizationDirectory(session.organizationId)
  const others = [...directory.values()].filter((person) => person.userId !== session.userId)
  const allowed = await whoMay(
    session,
    resourceType,
    resourceId,
    access.container.projectId,
    others.map((person) => person.userId),
    needed,
  )
  return others
    .filter((person) => allowed.has(person.userId))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type CandidateAccess = 'read' | 'write'

async function whoMay(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  projectId: string | null,
  userIds: readonly string[],
  needed: CandidateAccess,
): Promise<Set<string>> {
  if (resourceType === 'document') {
    const doc = await findDocumentForSession(session, resourceId)
    if (!doc) throw new NotFoundError()
    if (needed === 'write') return mayWriteDocument(session, doc, userIds)
    if (doc.scope === 'project' || doc.scope === 'office_shelf') return mayOpenDocument(session, doc, userIds)
  }
  if (!projectId) return new Set(userIds)
  return filterUsersWithProjectAccess(session, projectId, userIds)
}

export async function listResourceAssignments(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<AssignedPerson[]> {
  if (!isCollaborationEnabled(session)) {
    throw new NotFoundError()
  }
  await requireResourceAccess(session, resourceType, resourceId, 'viewer')
  const grouped = await listAssignmentsWithoutAccessCheck(session, resourceType, [resourceId])
  return grouped[resourceId] ?? []
}

export async function listAssignmentsWithoutAccessCheck(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceIds: readonly string[],
): Promise<Record<string, AssignedPerson[]>> {
  if (resourceIds.length === 0) return {}
  const rows = await listAssignmentsForResources(session.organizationId, resourceType, resourceIds)
  const directory = await loadOrganizationDirectory(session.organizationId)
  const grouped: Record<string, AssignedPerson[]> = {}
  for (const row of rows) {
    const person = directory.get(row.subjectUserId) ?? unknownPerson(row.subjectUserId)
    const list = grouped[row.resourceId] ?? []
    list.push({ ...person, assignedBy: row.assignedBy })
    grouped[row.resourceId] = list
  }
  return grouped
}

export async function addResourceAssignment(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
  request?: Request,
): Promise<AssignedPerson[]> {
  if (!isCollaborationEnabled(session)) {
    throw new NotFoundError()
  }
  const access = await requireResourceAccess(session, resourceType, resourceId, 'collaborator')
  await requireResourceWriteAccess(session, resourceType, resourceId)
  if (!subjectUserId.trim()) {
    throw new BadRequestError('A person is required')
  }

  const allowed = await whoMay(session, resourceType, resourceId, access.container.projectId, [subjectUserId], 'read')
  if (!allowed.has(subjectUserId)) {
    throw new BadRequestError('That person cannot open this, so they cannot be assigned to it', {
      reason: 'container-access-required',
    })
  }

  await insertAssignment({
    organizationId: session.organizationId,
    resourceType,
    resourceId,
    subjectUserId,
    assignedBy: session.userId,
  })

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'resource.assigned',
    targetType: resourceType,
    targetId: resourceId,
    metadata: { subjectUserId },
    request,
  })

  if (subjectUserId !== session.userId) {
    const descriptor = describeResource(resourceType)
    const ref = await descriptor.describeRef(resourceId, session.organizationId)
    await emitInboxItems([
      {
        organizationId: session.organizationId,
        recipientUserId: subjectUserId,
        type: 'document.assigned_to_you',
        resourceType,
        resourceId,
        actorUserId: session.userId,
        groupKey: inboxGroupKey('document.assigned_to_you', resourceType, resourceId),
        payload: { subject: ref?.title ?? null },
      },
    ])
  }

  const grouped = await listAssignmentsWithoutAccessCheck(session, resourceType, [resourceId])
  return grouped[resourceId] ?? []
}

export async function removeResourceAssignment(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
  request?: Request,
): Promise<AssignedPerson[]> {
  if (!isCollaborationEnabled(session)) {
    throw new NotFoundError()
  }
  await requireResourceAccess(session, resourceType, resourceId, 'collaborator')
  await requireResourceWriteAccess(session, resourceType, resourceId)
  await deleteAssignment(session.organizationId, resourceType, resourceId, subjectUserId)

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'resource.unassigned',
    targetType: resourceType,
    targetId: resourceId,
    metadata: { subjectUserId },
    request,
  })

  const grouped = await listAssignmentsWithoutAccessCheck(session, resourceType, [resourceId])
  return grouped[resourceId] ?? []
}

export async function assignMany(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceIds: readonly string[],
  subjectUserId: string,
  request?: Request,
): Promise<void> {
  for (const resourceId of resourceIds) {
    await addResourceAssignment(session, resourceType, resourceId, subjectUserId, request)
  }
}
