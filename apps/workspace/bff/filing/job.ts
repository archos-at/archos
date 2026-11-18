import 'server-only'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { FilingReviewPayload, JobSliceResult } from '@/lib/jobs-queue/types'
import { reviewUploadFiling } from './service'

export async function runFilingReviewSlice(
  session: AuthorizedSession,
  payload: FilingReviewPayload
): Promise<JobSliceResult<FilingReviewPayload>> {
  try {
    await reviewUploadFiling(session, payload.batchId, payload.basis)
  } catch (error) {
    if (!(error instanceof NotFoundError || error instanceof ForbiddenError)) throw error
    console.warn(`[filing] no review of batch ${payload.batchId} for ${session.userId}:`, error.message)
  }
  return { done: true, payload }
}
