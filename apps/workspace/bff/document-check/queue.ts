import 'server-only'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { withTenant } from '@/lib/db/tenant-context'
import { claimRevisionAnnouncement, releaseRevisionAnnouncement } from '@/lib/documents/revision-announcement-repository'
import { consumeLimit } from '@/lib/limits'
import { insertJobIfAbsent } from '@/lib/jobs-queue/repository'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { noticeDelaySeconds } from '@/lib/revision-notice/notice'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { documentCheckDailyLimit, documentCheckId } from './check'

const DAY_MS = 24 * 60 * 60 * 1000

export interface DocumentCheckRequest {
  organizationId: string
  actorUserId: string | null
  actorEmail?: string | null
  documentId: string
  versionId: string | null
}

export async function queueDocumentCheck(request: DocumentCheckRequest, now = new Date()): Promise<boolean> {
  const { organizationId, actorUserId, documentId } = request
  if (!actorUserId) return false
  const dailyLimit = documentCheckDailyLimit()
  if (dailyLimit === 0) return false
  const checkId = documentCheckId(documentId, request.versionId ?? 'first')
  const claim = { organizationId, documentId, anchorId: checkId }
  let claimed = false
  try {
    if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.agentNotices, organizationId))) return false
    claimed = await claimRevisionAnnouncement(claim)
    if (!claimed) return false
    const spent = await consumeLimit({ name: 'document-check-daily', limit: dailyLimit, windowMs: DAY_MS }, organizationId)
    if (!spent.allowed) {
      console.warn(`[document-check] the daily cap of ${dailyLimit} is reached for ${organizationId}; skipping ${documentId}`)
      return false
    }
    const queued = await withTenant({ organizationId }, () =>
      insertJobIfAbsent({
        kind: 'document_check',
        organizationId,
        priority: BFF_JOB_PRIORITY.bulk,
        jobId: checkId,
        notBefore: new Date(now.getTime() + noticeDelaySeconds() * 1000),
        payload: {
          checkId,
          documentId,
          actor: { userId: actorUserId, email: request.actorEmail ?? null },
          conversationId: null,
          waits: 0,
        },
      }),
    )
    if (!queued) await releaseRevisionAnnouncement(claim)
    return queued
  } catch (error) {
    console.warn(`[document-check] could not queue the check of ${documentId}:`, error)
    if (claimed) await releaseRevisionAnnouncement(claim).catch(() => undefined)
    return false
  }
}
