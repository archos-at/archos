import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { lookupSubjectMembership, resolveSubjectMembership } from '@/lib/authz/project-membership'
import { rolePermissions } from '@/lib/authz/org-role-permissions'
import { enabledFlagsForOrganization } from '@/lib/workos/feature-flags'
import { resolvePerson } from './person'

export interface PinnedRequester {
  userId: string
  email: string | null
  organizationId: string
}

export async function resolvePinnedRequesterSession(requester: PinnedRequester): Promise<AuthorizedSession | null> {
  const membership = await resolveSubjectMembership(requester.organizationId, requester.userId)
  return sessionFor(requester, membership)
}

export async function resolvePinnedRequesterSessionStrict(
  requester: PinnedRequester,
): Promise<AuthorizedSession | null> {
  const membership = await lookupSubjectMembership(requester.organizationId, requester.userId)
  return sessionFor(requester, membership)
}

async function sessionFor(
  requester: PinnedRequester,
  membership: Awaited<ReturnType<typeof lookupSubjectMembership>>,
): Promise<AuthorizedSession | null> {
  if (!membership || !membership.role) return null

  const [featureFlags, person, permissions] = await Promise.all([
    enabledFlagsForOrganization(requester.organizationId),
    resolvePerson(requester.organizationId, requester.userId),
    rolePermissions(requester.organizationId, membership.roles),
  ])

  return {
    userId: requester.userId,
    email: requester.email ?? person.email ?? '',
    name: person.name,
    organizationName: person.organizationName,
    accessToken: '',
    organizationId: requester.organizationId,
    organizationMembershipId: membership.organizationMembershipId,
    role: membership.role,
    roles: membership.roles,
    permissions: [...permissions],
    featureFlags,
  }
}
