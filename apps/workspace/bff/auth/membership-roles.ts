import 'server-only'
import { lookupSubjectMembership } from '@/lib/authz/project-membership'

export async function resolveMembershipRoles(organizationId: string, userId: string): Promise<string[] | null> {
  try {
    return (await lookupSubjectMembership(organizationId, userId))?.roles ?? []
  } catch (error) {
    console.warn(`[membership-roles] lookup failed for ${userId}:`, error)
    return null
  }
}
