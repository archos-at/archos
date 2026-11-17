import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { filterUsersWhoMayReadFolder, filterUsersWhoMayWriteFolder } from '@/lib/authz/folder-access'
import { DOCUMENT_WRITE_PERMISSIONS } from '@/lib/authz/folder-access-rule'
import { rolesHoldPermission } from '@/lib/authz/org-role-permissions'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import {
  PERMISSION_CHECKS_AT_ONCE,
  resolveSubjectMembership,
  userHoldsProjectPermission,
} from '@/lib/authz/project-membership'
import type { Document } from '@/lib/db/schema/documents'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { hasPassedScreening } from './document-reader'
import { isQuarantineReviewer } from './quarantine-reviewers'
import { inPool } from '@/lib/utils/in-pool'

export type OpenableDocument = Pick<
  Document,
  'scope' | 'projectId' | 'folderId' | 'createdBy' | 'status' | 'authoredBy' | 'screeningOutcome' | 'contentHash' | 'screenedHash'
>

export async function mayOpenDocument(
  tenant: Pick<AuthorizedSession, 'organizationId'>,
  doc: OpenableDocument,
  userIds: readonly string[]
): Promise<Set<string>> {
  const asked = [...new Set(userIds)]
  const people = hasPassedScreening(doc) ? asked : await heldFor(tenant.organizationId, doc, asked)
  return mayOpenOnItsShelf(tenant.organizationId, doc, people)
}

async function heldFor(organizationId: string, doc: OpenableDocument, userIds: readonly string[]): Promise<string[]> {
  const verdicts = await inPool([...userIds], PERMISSION_CHECKS_AT_ONCE, async (userId) =>
    userId === doc.createdBy || (await isQuarantineReviewer(organizationId, doc, userId)) ? userId : null
  )
  return verdicts.filter((userId): userId is string => userId !== null)
}

async function mayOpenOnItsShelf(
  organizationId: string,
  doc: OpenableDocument,
  people: readonly string[]
): Promise<Set<string>> {
  if (people.length === 0) return new Set()
  if (doc.scope === 'office_shelf') {
    const directory = await loadOrganizationDirectory(organizationId)
    return new Set(people.filter((userId) => directory.has(userId)))
  }
  if (doc.scope !== 'project' || !doc.projectId) return new Set()
  const projectId = doc.projectId
  const inProject = await inPool(people, PERMISSION_CHECKS_AT_ONCE, async (userId) =>
    (await userHoldsProjectPermission({ organizationId }, projectId, userId, 'project:view')) ? userId : null
  )
  return filterUsersWhoMayReadFolder(
    organizationId,
    projectId,
    doc.folderId ?? null,
    inProject.filter((userId): userId is string => userId !== null)
  )
}

export async function mayWriteDocument(
  tenant: Pick<AuthorizedSession, 'organizationId'>,
  doc: OpenableDocument,
  userIds: readonly string[]
): Promise<Set<string>> {
  const asked = [...new Set(userIds)]
  const people = hasPassedScreening(doc) ? asked : await heldFor(tenant.organizationId, doc, asked)
  if (people.length === 0) return new Set()
  const { organizationId } = tenant
  if (doc.scope === 'office_shelf') {
    const curators = await inPool(people, PERMISSION_CHECKS_AT_ONCE, async (userId) => {
      const membership = await resolveSubjectMembership(organizationId, userId)
      if (!membership) return null
      return (await rolesHoldPermission(organizationId, membership.roles, ORG_PERMISSIONS.officeShelfManage)) ? userId : null
    })
    return new Set(curators.filter((userId): userId is string => userId !== null))
  }
  if (doc.scope !== 'project' || !doc.projectId) return new Set()
  const projectId = doc.projectId
  const writers = await inPool(people, PERMISSION_CHECKS_AT_ONCE, async (userId) => {
    for (const permission of DOCUMENT_WRITE_PERMISSIONS) {
      if (await userHoldsProjectPermission({ organizationId }, projectId, userId, permission)) return userId
    }
    return null
  })
  return filterUsersWhoMayWriteFolder(
    organizationId,
    projectId,
    doc.folderId ?? null,
    writers.filter((userId): userId is string => userId !== null)
  )
}
