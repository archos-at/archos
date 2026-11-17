import 'server-only'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { userHoldsProjectPermission } from '@/lib/authz/project-membership'
import type { UploadBatch } from '@/lib/db/schema/upload-batches'
import { withTenant } from '@/lib/db/tenant-context'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY, requesterOf, type ProjectIntakeReadPayload } from '@/lib/jobs-queue/types'
import { listOpenIntakeProjectIds } from './repository'

const PROFILE_WRITE = ['project:memory:write', 'project:edit'] as const

async function mayWriteProfile(organizationId: string, projectId: string, userId: string): Promise<boolean> {
  for (const permission of PROFILE_WRITE) {
    if (await userHoldsProjectPermission({ organizationId }, projectId, userId, permission)) return true
  }
  return false
}

export async function enqueueIntakeRead(organizationId: string, projectId: string, userId: string): Promise<boolean> {
  const session = await resolvePinnedRequesterSession({ userId, email: null, organizationId })
  if (!session) return false
  if (!(await mayWriteProfile(organizationId, projectId, userId))) return false
  const payload: ProjectIntakeReadPayload = { projectId, requester: requesterOf(session) }
  await withTenant({ organizationId }, () =>
    enqueueJob({
      kind: 'project_intake_read',
      organizationId,
      payload,
      priority: BFF_JOB_PRIORITY.bulk,
    })
  )
  return true
}

export async function queueIntakeReadsAfterUpload(
  organizationId: string,
  completed: readonly Pick<UploadBatch, 'scope' | 'projectId' | 'createdBy' | 'startsIntake'>[]
): Promise<string[]> {
  const uploaderOf = new Map<string, string>()
  for (const batch of completed) {
    if (!batch.startsIntake || batch.scope !== 'project' || !batch.projectId || uploaderOf.has(batch.projectId)) continue
    uploaderOf.set(batch.projectId, batch.createdBy)
  }
  if (uploaderOf.size === 0) return []
  const open = await listOpenIntakeProjectIds(organizationId, [...uploaderOf.keys()])
  const queued = await Promise.all(
    open.map(async (projectId) =>
      (await enqueueIntakeRead(organizationId, projectId, uploaderOf.get(projectId) ?? '')) ? projectId : null
    )
  )
  return queued.filter((projectId): projectId is string => projectId !== null)
}
