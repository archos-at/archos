import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import { liveFolderAccess } from '@/lib/permits/live-access'
import { listPermitRecordsForProject, type ListedPermitRecord } from '@/lib/permits/repository'
import { memoryClearance } from '@/lib/projects/service'
import { SIMILAR_PERMIT_RECORDS_READ, SIMILAR_PERMIT_REQUIREMENTS_MAX } from './types'

export async function listPermitRecordsForPerson(
  session: AuthorizedSession,
  projectId: string
): Promise<ListedPermitRecord[]> {
  await requireProjectAccess(session, projectId, 'project:view')
  const { cleared } = await memoryClearance(session, projectId)
  const access = await liveFolderAccess(session.organizationId, projectId, cleared)
  return listPermitRecordsForProject(session.organizationId, projectId, access.visibleFolderIds, {
    maxRecords: SIMILAR_PERMIT_RECORDS_READ,
    maxPerRecord: SIMILAR_PERMIT_REQUIREMENTS_MAX,
  })
}
