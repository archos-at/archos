import 'server-only'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import type { DbExecutor } from '@/lib/db/executor'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { insertJobIfAbsent } from '@/lib/jobs-queue/repository'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { noticeDelaySeconds, revisionNoticeId } from './notice'

export interface RevisionNoticeRequest {
  organizationId: string
  actorUserId: string | null
  actorEmail?: string | null
  newerId: string
  olderId: string
}

export type RevisionNoticeJob = Parameters<typeof insertJobIfAbsent>[0]

export async function planRevisionNotice(request: RevisionNoticeRequest, now = new Date()): Promise<RevisionNoticeJob | null> {
  const { organizationId, actorUserId, newerId, olderId } = request
  if (!actorUserId || newerId === olderId) return null
  if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.agentNotices, organizationId))) return null
  const noticeId = revisionNoticeId(newerId, olderId)
  return {
    kind: 'revision_notice',
    organizationId,
    priority: BFF_JOB_PRIORITY.bulk,
    jobId: noticeId,
    notBefore: new Date(now.getTime() + noticeDelaySeconds() * 1000),
    payload: {
      noticeId,
      newerId,
      olderId,
      actor: { userId: actorUserId, email: request.actorEmail ?? null },
    },
  }
}

export function insertRevisionNotice(job: RevisionNoticeJob, executor: DbExecutor): Promise<boolean> {
  return insertJobIfAbsent(job, executor)
}
