import 'server-only'
import { filterUsersWhoMayWriteFolder } from '@/lib/authz/folder-access'
import { DOCUMENT_WRITE_PERMISSIONS } from '@/lib/authz/folder-access-rule'
import { rolesHoldPermission } from '@/lib/authz/org-role-permissions'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { resolveSubjectMembership, userHoldsProjectPermission } from '@/lib/authz/project-membership'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'

async function managesOfficeShelf(organizationId: string, userId: string): Promise<boolean> {
  const membership = await resolveSubjectMembership(organizationId, userId)
  return membership !== null && rolesHoldPermission(organizationId, membership.roles, ORG_PERMISSIONS.officeShelfManage)
}

async function writesProject(organizationId: string, projectId: string, userId: string): Promise<boolean> {
  for (const permission of DOCUMENT_WRITE_PERMISSIONS) {
    if (await userHoldsProjectPermission({ organizationId }, projectId, userId, permission)) return true
  }
  return false
}

export async function normDecidersOf(
  organizationId: string,
  projectId: string,
  folderIds: readonly (string | null)[],
  except: string
): Promise<string[]> {
  const directory = await loadOrganizationDirectory(organizationId)
  const verdicts = await Promise.all(
    [...directory.keys()]
      .filter((userId) => userId !== except)
      .map(async (userId) =>
        (await managesOfficeShelf(organizationId, userId)) && (await writesProject(organizationId, projectId, userId)) ? userId : null
      )
  )
  let deciders = verdicts.filter((userId): userId is string => userId !== null)
  for (const folderId of new Set(folderIds)) {
    deciders = [...(await filterUsersWhoMayWriteFolder(organizationId, projectId, folderId, deciders))]
  }
  return deciders
}
