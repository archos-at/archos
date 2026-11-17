import 'server-only'

import { isFolderVisibleToMember } from '@/lib/authz/folder-access'
import { rolesHoldPermission } from '@/lib/authz/org-role-permissions'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { resolveSubjectMembership, userHoldsProjectPermission } from '@/lib/authz/project-membership'
import type { Document } from '@/lib/db/schema/documents'

export async function isQuarantineReviewer(
  organizationId: string,
  document: Pick<Document, 'scope' | 'projectId' | 'folderId'>,
  userId: string
): Promise<boolean> {
  const membership = await resolveSubjectMembership(organizationId, userId)
  if (!membership) return false
  if (await rolesHoldPermission(organizationId, membership.roles, ORG_PERMISSIONS.projectsAdminister)) return true
  if (document.scope === 'office_shelf') {
    return rolesHoldPermission(organizationId, membership.roles, ORG_PERMISSIONS.officeShelfManage)
  }
  if (document.scope !== 'project' || !document.projectId) return false
  const manages = await userHoldsProjectPermission({ organizationId }, document.projectId, userId, 'project:manage')
  if (!manages) return false
  return isFolderVisibleToMember(organizationId, document.projectId, document.folderId, userId)
}
