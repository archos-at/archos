/**
 * Run one slice of a job inside its organization (ADR-0079): what a `bff-job`
 * run on Hatchet does with the row it took (`./hatchet-task.ts`).
 *
 * The lane is the organization, so the work runs inside it and row-level
 * security applies to everything the handler reads and writes. Marked as a
 * slice, so nothing it calls reads a request it does not have (`./slice-scope`).
 */

import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { JOB_HANDLERS } from './handlers'
import { runAsJobSlice } from './slice-scope'
import { isBffJobKind, type JobSliceResult } from './types'

/** No handler knows this kind: no attempt will find one. */
export class UnknownJobKindError extends Error {
  override name = 'UnknownJobKindError'
  constructor(kind: string) {
    super(`No handler for job kind "${kind}"`)
  }
}

/** Hatchet gave the attempt up before its slice started: the slice did not run. */
export class SliceAbortedError extends Error {
  override name = 'SliceAbortedError'
  constructor() {
    super('The attempt was aborted before its slice started')
  }
}

/**
 * Run the slice, unless the attempt is already aborted. A slice that has
 * started cannot be killed from here; the handler is handed `signal` to stop
 * on its own where it can.
 */
export async function runHandler(job: {
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
      JOB_HANDLERS[kind]({ organizationId: job.organizationId, payload: job.payload, attempts: job.attempts, signal: job.signal })
    )
  )
}
