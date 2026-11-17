/**
 * Queue a notice of a new Fassung (ADR-0130), when one was just announced.
 *
 * Called by `notifyNewRevision` (`lib/documents/revision-notify.ts`), which
 * claims the announcement of a Fassung under another name and stores this job
 * in the same transaction: both exist or neither does, so a Fassung is noticed
 * exactly once however often its document settles again, and a failed enqueue
 * leaves no claim behind that would keep the notice from ever being queued. Only a
 * link between two documents is noticed: a same-name version replaces the
 * older bytes in the index, so there is nothing left to compare it with.
 *
 * Gated per organization (`piloti-notices`, read from WorkOS for the
 * organization, since nobody's session is at hand) and held for
 * `REVISION_NOTICE_DELAY_SECONDS`, so a burst of re-reads and relinks has
 * settled before a model looks. The job's id is the pair's, so a second
 * enqueue while one waits is no second job.
 */

import 'server-only'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import type { DbExecutor } from '@/lib/db/executor'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { insertJobIfAbsent } from '@/lib/jobs-queue/repository'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { noticeDelaySeconds, revisionNoticeId } from './notice'

export interface RevisionNoticeRequest {
  organizationId: string
  /** The person whose upload or link made the Fassung. No person, no notice: it would act for nobody. */
  actorUserId: string | null
  actorEmail?: string | null
  newerId: string
  olderId: string
}

/** The job row of one notice: what {@link planRevisionNotice} decides and {@link insertRevisionNotice} stores. */
export type RevisionNoticeJob = Parameters<typeof insertJobIfAbsent>[0]

/**
 * The job to queue for this Fassung, or null when none is wanted (no person to
 * act as, a document compared with itself, or the office has not switched it
 * on). Reads the flag from WorkOS, so it runs BEFORE the caller's transaction,
 * never inside it. `isOrgFeatureEnabled` treats a failed read as off, so a
 * WorkOS outage skips the notice and still announces to people; should this
 * ever throw, the caller has claimed nothing yet.
 */
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

/**
 * Store the job row in the caller's transaction (the claim of the announcement
 * commits with it or not at all). No run is triggered here: the dispatch sweep
 * starts it, which suits a job held for the debounce anyway. Whether it was added.
 */
export function insertRevisionNotice(job: RevisionNoticeJob, executor: DbExecutor): Promise<boolean> {
  return insertJobIfAbsent(job, executor)
}
