import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { JOB_HANDLERS } from './handlers'
import { runAsJobSlice } from './slice-scope'
import { isBffJobKind, type JobSliceResult } from './types'

export class UnknownJobKindError extends Error {
  override name = 'UnknownJobKindError'
  constructor(kind: string) {
    super(`No handler for job kind "${kind}"`)
  }
}

export class SliceAbortedError extends Error {
  override name = 'SliceAbortedError'
  constructor() {
    super('The attempt was aborted before its slice started')
  }
}

export async function runHandler(job: {
  jobId?: string
  kind: string
  organizationId: string
  payload: unknown
  attempts: number
  signal?: AbortSignal
}): Promise<JobSliceResult<object>> {
  const kind = job.kind
  if (!isBffJobKind(kind)) throw new UnknownJobKindError(kind)
  if (job.signal?.aborted) throw new SliceAbortedError()
  return runAsJobSlice(() =>
    withTenant({ organizationId: job.organizationId }, () =>
      JOB_HANDLERS[kind]({ jobId: job.jobId, organizationId: job.organizationId, payload: job.payload, attempts: job.attempts, signal: job.signal })
    )
  )
}
