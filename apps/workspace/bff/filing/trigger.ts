import 'server-only'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { UploadBatch } from '@/lib/db/schema/upload-batches'
import { withTenant } from '@/lib/db/tenant-context'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY, requesterOf, type FilingReviewPayload } from '@/lib/jobs-queue/types'
import type { FilingBasis } from './types'

export function filingSuggestionsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.FILING_SUGGESTIONS ?? '').trim().toLowerCase() !== 'off'
}

type QueuedBatch = Pick<UploadBatch, 'id' | 'scope' | 'createdBy' | 'reviewsFiling'>

export async function queueFilingReview(organizationId: string, batch: QueuedBatch, basis: FilingBasis): Promise<boolean> {
  if (!filingSuggestionsEnabled() || batch.scope === 'session' || !batch.reviewsFiling) return false
  try {
    const session = await resolvePinnedRequesterSession({ userId: batch.createdBy, email: null, organizationId })
    if (!session) return false
    const payload: FilingReviewPayload = { batchId: batch.id, basis, requester: requesterOf(session) }
    await withTenant({ organizationId }, () =>
      enqueueJob({
        kind: 'filing_review',
        organizationId,
        payload,
        priority: basis === 'name' ? BFF_JOB_PRIORITY.interactive : BFF_JOB_PRIORITY.bulk,
      })
    )
    return true
  } catch (error) {
    console.warn(`[filing] queueing the ${basis} review of batch ${batch.id} failed; the upload is unaffected:`, error)
    return false
  }
}

export async function queueFilingReviewsAfterSettle(
  organizationId: string,
  completed: readonly QueuedBatch[]
): Promise<void> {
  await Promise.all(completed.map((batch) => queueFilingReview(organizationId, batch, 'content')))
}
