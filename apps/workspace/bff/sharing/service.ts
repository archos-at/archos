import 'server-only'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DbExecutor } from '@/lib/db/executor'
import type { ResourceRole, ResourceVisibility, ShareableResourceType } from '@/lib/db/schema/resource-shares'
import type { AudienceWidening } from '@/lib/conversations/restricted-use'
import { publishToUsers } from '@/lib/events/bus'
import { requireResourceAccess, requireResourceWriteAccess } from './access'
import { loadOrganizationDirectory, unknownPerson } from './directory'
import { notifyOwnersOfTakeover, resolveOwners } from './ownership-notice'
import { describeResource, roleSatisfies, type ShareableDescriptor } from './registry'
import { consumeLimit, memberSubject, SHARE_LIMIT } from '@/lib/limits'
import {
  countGrantsForResource,
  deleteGrant,
  listGrantsForResource,
  upsertGrant,
  SHARE_ROSTER_LIMIT,
} from './repository'
import { SHARING_ERROR_REASONS, type ResourceAccessEntry, type ResourceSharingState } from './types'

export type { ResourceAccessEntry, ResourceSharingState }

async function assertMayWiden(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  widening: AudienceWidening,
): Promise<void> {
  const guard = describeResource(resourceType).assertMayWiden
  if (guard) await guard(session, resourceId, widening)
}

async function widen<T>(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  widening: AudienceWidening,
  write: (executor?: DbExecutor) => Promise<T>,
): Promise<T> {
  const guard = describeResource(resourceType).widenAudience
  return guard ? guard(session, resourceId, widening, write) : write()
}

export async function getSharingState(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<ResourceSharingState> {
  const access = await requireResourceAccess(session, resourceType, resourceId, 'viewer', { allowLocked: true })
  const descriptor = describeResource(resourceType)
  const probe = await descriptor.probe(resourceId)
  const grants = await listGrantsForResource(session.organizationId, resourceType, resourceId)
  const directory = await loadOrganizationDirectory(session.organizationId)

  const entries: ResourceAccessEntry[] = []

  if (probe?.createdBy) {
    entries.push({
      person: directory.get(probe.createdBy) ?? unknownPerson(probe.createdBy),
      role: 'owner',
      reason: 'creator',
      grantedBy: null,
    })
  }

  for (const grant of grants) {
    if (grant.subjectUserId === probe?.createdBy) continue // already listed as creator
    entries.push({
      person: directory.get(grant.subjectUserId) ?? unknownPerson(grant.subjectUserId),
      role: grant.role,
      reason: 'grant',
      grantedBy: grant.grantedBy,
    })
  }

  return {
    resourceType,
    resourceId,
    visibility: access.visibility,
    allowedVisibilities: descriptor.allowedVisibilities,
    myRole: access.role,
    canManage: roleSatisfies(access.role, 'owner') && !access.contentLocked,
    canEscalate: access.canEscalate,
    entries: await markLostAccess(session, descriptor, resourceId, entries),
    shared: access.visibility !== 'private' || grants.length > 0,
  }
}

async function markLostAccess(
  session: AuthorizedSession,
  descriptor: ShareableDescriptor,
  resourceId: string,
  entries: readonly ResourceAccessEntry[],
): Promise<ResourceAccessEntry[]> {
  if (!descriptor.readersAmong || entries.length === 0) return [...entries]
  const readers = await descriptor.readersAmong(
    session.organizationId,
    resourceId,
    entries.map((entry) => entry.person.userId),
    session,
  )
  return entries.map((entry) => ({ ...entry, lostAccess: !readers.has(entry.person.userId) }))
}

export async function setResourceVisibility(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  visibility: ResourceVisibility,
  request?: Request,
): Promise<ResourceSharingState> {
  const access = await requireResourceAccess(session, resourceType, resourceId, 'owner')
  await requireResourceWriteAccess(session, resourceType, resourceId)
  const descriptor = describeResource(resourceType)

  if (!descriptor.allowedVisibilities.includes(visibility)) {
    throw new BadRequestError(`Visibility "${visibility}" is not available for this resource`, {
      allowed: descriptor.allowedVisibilities,
    })
  }

  if (visibility === access.visibility) {
    return getSharingState(session, resourceType, resourceId)
  }

  if (visibility !== 'private') {
    await assertMayWiden(session, resourceType, resourceId, { kind: 'visibility' })
  }

  const previousAudience = await resolveParticipants(session.organizationId, resourceType, resourceId)

  const write = (executor?: DbExecutor) =>
    descriptor.setVisibility(resourceId, session.organizationId, visibility, executor)
  const written =
    visibility === 'private'
      ? await write()
      : await widen(session, resourceType, resourceId, { kind: 'visibility' }, write)
  if (!written) throw new NotFoundError()

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'resource.visibility.changed',
    targetType: resourceType,
    targetId: resourceId,
    metadata: { from: access.visibility, to: visibility },
    request,
  })

  const nextAudience = await resolveParticipants(session.organizationId, resourceType, resourceId)
  await publishToUsers([...new Set([...previousAudience, ...nextAudience])], {
    kind: 'resource.access.changed',
    resourceType,
    resourceId,
    change: 'visibility',
  })

  return getSharingState(session, resourceType, resourceId)
}

export interface GrantAccessInput {
  subjectUserId: string
  role: ResourceRole
}

export async function grantResourceAccess(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  input: GrantAccessInput,
  request?: Request,
): Promise<ResourceSharingState> {
  const access = await requireResourceAccess(session, resourceType, resourceId, 'owner')
  await requireResourceWriteAccess(session, resourceType, resourceId)

  if (input.subjectUserId === session.userId) {
    throw new BadRequestError('You already have access to this resource')
  }

  const descriptor = describeResource(resourceType)
  if (!descriptor.roles.includes(input.role)) {
    throw new BadRequestError(`Role "${input.role}" is not available for this resource`)
  }

  const widening: AudienceWidening = { kind: 'person', userId: input.subjectUserId, self: false }
  await assertMayWiden(session, resourceType, resourceId, widening)

  const limit = await consumeLimit(SHARE_LIMIT, memberSubject(session))
  if (!limit.allowed) {
    throw new ForbiddenError('Too many sharing changes. Please wait a few minutes and try again.', {
      reason: SHARING_ERROR_REASONS.rateLimited,
    })
  }

  const existing = await countGrantsForResource(resourceType, resourceId)
  if (existing >= SHARE_ROSTER_LIMIT) {
    throw new ConflictError(`This resource already has the maximum of ${SHARE_ROSTER_LIMIT} people.`, {
      reason: SHARING_ERROR_REASONS.rosterFull,
    })
  }

  await assertInviteeCanReachContainer(session, resourceType, resourceId, input.subjectUserId)

  await widen(session, resourceType, resourceId, widening, (executor) =>
    upsertGrant(
      {
        organizationId: session.organizationId,
        resourceType,
        resourceId,
        subjectUserId: input.subjectUserId,
        role: input.role,
        grantedBy: session.userId,
      },
      executor,
    ),
  )

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'resource.shared',
    targetType: resourceType,
    targetId: resourceId,
    metadata: { subject: input.subjectUserId, role: input.role, visibility: access.visibility },
    request,
  })

  await publishToUsers([input.subjectUserId], {
    kind: 'resource.access.changed',
    resourceType,
    resourceId,
    change: 'granted',
  })

  return getSharingState(session, resourceType, resourceId)
}

async function assertInviteeCanReachContainer(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
): Promise<void> {
  const descriptor = describeResource(resourceType)
  const probe = await descriptor.probe(resourceId)
  if (!probe) throw new NotFoundError()

  const { canUserAccessProject, isUserInOrganization } = await import(
    '@/lib/authz/project-membership'
  )

  if (!probe.projectId) {
    if (!(await isUserInOrganization(session, subjectUserId))) {
      throw new BadRequestError(
        'That person is not a member of this organization.',
        { reason: SHARING_ERROR_REASONS.organizationMembershipRequired },
      )
    }
    return
  }

  const reachable = await canUserAccessProject(session, probe.projectId, subjectUserId)
  if (!reachable) {
    throw new BadRequestError(
      'That person is not a member of this project yet. Add them to the project first — sharing a resource never grants project access.',
      { reason: SHARING_ERROR_REASONS.containerAccessRequired, projectId: probe.projectId },
    )
  }
}

export async function changeResourceRole(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  input: GrantAccessInput,
  request?: Request,
): Promise<ResourceSharingState> {
  await requireResourceAccess(session, resourceType, resourceId, 'owner')
  await requireResourceWriteAccess(session, resourceType, resourceId)

  const grants = await listGrantsForResource(session.organizationId, resourceType, resourceId)
  const currentRole = grants.find((grant) => grant.subjectUserId === input.subjectUserId)?.role
  if (!currentRole) {
    const probe = await describeResource(resourceType).probe(resourceId)
    if (probe?.createdBy !== input.subjectUserId) throw new NotFoundError()
  }

  if (currentRole === input.role) {
    return getSharingState(session, resourceType, resourceId)
  }

  await assertNotLastOwner(session, resourceType, resourceId, input.subjectUserId, input.role === 'owner')

  await upsertGrant({
    organizationId: session.organizationId,
    resourceType,
    resourceId,
    subjectUserId: input.subjectUserId,
    role: input.role,
    grantedBy: session.userId,
  })

  if (input.role === 'viewer') {
    const { voidRequestsForSubject } = await import('@/lib/mentions/service')
    await voidRequestsForSubject(resourceType, resourceId, input.subjectUserId)
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'resource.share.role_changed',
    targetType: resourceType,
    targetId: resourceId,
    metadata: { subject: input.subjectUserId, from: currentRole ?? null, role: input.role },
    request,
  })

  await publishToUsers([input.subjectUserId], {
    kind: 'resource.access.changed',
    resourceType,
    resourceId,
    change: 'role_changed',
  })

  return getSharingState(session, resourceType, resourceId)
}

export async function revokeResourceAccess(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
  request?: Request,
): Promise<ResourceSharingState> {
  const isSelfRemoval = subjectUserId === session.userId
  await requireResourceAccess(session, resourceType, resourceId, isSelfRemoval ? 'viewer' : 'owner', {
    allowLocked: true,
  })
  if (!isSelfRemoval) await requireResourceWriteAccess(session, resourceType, resourceId)
  await assertNotLastOwner(session, resourceType, resourceId, subjectUserId, false)

  const removed = await deleteGrant(session.organizationId, resourceType, resourceId, subjectUserId)
  if (!removed) throw new NotFoundError()

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'resource.share.revoked',
    targetType: resourceType,
    targetId: resourceId,
    metadata: { subject: subjectUserId, self: isSelfRemoval },
    request,
  })

  const { voidRequestsForSubject } = await import('@/lib/mentions/service')
  await voidRequestsForSubject(resourceType, resourceId, subjectUserId)
  const { markItemsInertForSubject } = await import('@/lib/inbox/service')
  await markItemsInertForSubject(resourceType, resourceId, subjectUserId)

  await publishToUsers([subjectUserId], {
    kind: 'resource.access.changed',
    resourceType,
    resourceId,
    change: 'revoked',
  })

  if (isSelfRemoval) {
    return {
      resourceType,
      resourceId,
      visibility: 'private',
      allowedVisibilities: describeResource(resourceType).allowedVisibilities,
      myRole: null,
      canManage: false,
      canEscalate: false,
      entries: [],
      shared: false,
    }
  }
  return getSharingState(session, resourceType, resourceId)
}

async function assertNotLastOwner(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  targetUserId: string,
  willRemainOwner: boolean,
): Promise<void> {
  if (willRemainOwner) return

  const descriptor = describeResource(resourceType)
  const probe = await descriptor.probe(resourceId)
  if (probe?.createdBy && probe.createdBy !== targetUserId) return

  const grants = await listGrantsForResource(session.organizationId, resourceType, resourceId)
  const owners = grants.filter((grant) => grant.role === 'owner').map((grant) => grant.subjectUserId)
  const remaining = owners.filter((userId) => userId !== targetUserId)
  if (remaining.length === 0) {
    throw new ConflictError(
      'This resource must keep at least one owner. Make someone else an owner before removing this one.',
      { reason: 'last-owner' },
    )
  }
}

export async function escalateToOwner(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  request?: Request,
): Promise<ResourceSharingState> {
  const access = await requireResourceAccess(session, resourceType, resourceId, 'viewer', { allowLocked: true })
  if (!access.canEscalate) {
    throw new NotFoundError()
  }
  const owners = await resolveOwners(session.organizationId, resourceType, resourceId)
  await requireResourceWriteAccess(session, resourceType, resourceId)
  const widening: AudienceWidening = { kind: 'person', userId: session.userId, self: true }
  await assertMayWiden(session, resourceType, resourceId, widening)

  await widen(session, resourceType, resourceId, widening, (executor) =>
    upsertGrant(
      {
        organizationId: session.organizationId,
        resourceType,
        resourceId,
        subjectUserId: session.userId,
        role: 'owner',
        grantedBy: session.userId,
      },
      executor,
    ),
  )

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'resource.ownership.escalated',
    targetType: resourceType,
    targetId: resourceId,
    metadata: { previousRole: access.role, via: 'project-admin' },
    request,
  })

  try {
    await publishToUsers(
      await resolveParticipants(session.organizationId, resourceType, resourceId),
      { kind: 'resource.access.changed', resourceType, resourceId, change: 'granted' },
    )
  } catch (error) {
    console.warn('[sharing] escalation fan-out failed (non-fatal):', error)
  }
  await notifyOwnersOfTakeover({
    organizationId: session.organizationId,
    resourceType,
    resourceId,
    actorUserId: session.userId,
    owners,
  })

  return getSharingState(session, resourceType, resourceId)
}

export async function resolveParticipants(
  organizationId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<string[]> {
  const descriptor = describeResource(resourceType)
  const [probe, grants] = await Promise.all([
    descriptor.probe(resourceId),
    listGrantsForResource(organizationId, resourceType, resourceId),
  ])
  const participants = new Set<string>()
  if (probe?.createdBy) participants.add(probe.createdBy)
  for (const grant of grants) participants.add(grant.subjectUserId)
  return [...participants]
}
