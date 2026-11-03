/**
 * Hand work to the `bff-jobs` pool (ADR-0079, ADR-0150).
 *
 * The door a service uses to turn a long request into a job: it does its own
 * authorization first, then enqueues and answers 202 with the job id. What runs
 * is `./handlers.ts`; this file knows nothing of it, so a service can enqueue
 * without importing the code the job will call back into.
 *
 * An enqueue is two steps. The job's row is stored, in the caller's
 * transaction when it hands one over, so the job exists exactly when the
 * caller's other writes do; then a `bff-job` run is started on Hatchet and
 * nothing waits for it. The start is best effort: the row is the job, and a
 * row no run is coming for (Hatchet was briefly away, or the run came before
 * the caller's transaction committed) is started by the dispatch sweep
 * (`./hatchet-task.ts`, `dispatchStrandedJobs`) within a few minutes.
 */

import 'server-only'
import type { DbExecutor } from '@/lib/db/executor'
import { BFF_JOB_PRIORITY, type BffJobKind, type BffJobPriority } from './types'
import { insertJob } from './repository'
import { priorityName } from './hatchet-task'
import { triggerBffJob } from './hatchet'

export interface EnqueuedJob {
  jobId: string
}

/**
 * Store a job in the lane of `organizationId`, which must be the active tenant,
 * and start its run.
 *
 * Bulk by default: this queue exists for the work that used to run inside one
 * long request (a reindex, a rescan), which must yield to a person's upload.
 * A job a person is waiting on says `interactive`.
 */
export async function enqueueJob(
  input: {
    kind: BffJobKind
    organizationId: string
    payload: Record<string, unknown>
    priority?: BffJobPriority
    /** The id to give the job, when the caller stamps it on rows in the same transaction. */
    jobId?: string
    /** Hold the job until then: a job handing its work on after a failure waits out a backoff. */
    notBefore?: Date
  },
  /** The caller's transaction, when the job must commit or roll back with its other writes. */
  executor?: DbExecutor
): Promise<EnqueuedJob> {
  const priority = input.priority ?? BFF_JOB_PRIORITY.bulk
  const jobId = await insertJob(
    {
      kind: input.kind,
      organizationId: input.organizationId,
      priority,
      payload: input.payload,
      jobId: input.jobId,
      notBefore: input.notBefore,
    },
    executor
  )
  const run = { job_id: jobId, kind: input.kind, organization_id: input.organizationId, priority: priorityName(priority), generation: 0 }
  // `then`, so a client that cannot even be built (no token) is caught here too.
  await Promise.resolve()
    .then(() => triggerBffJob(run, input.notBefore ? { notBefore: input.notBefore } : {}))
    .catch((error: unknown) => {
    console.warn(`[jobs] ${input.kind} ${jobId} is stored but its run did not start; the dispatch sweep will start it:`, error)
  })
  return { jobId }
}
