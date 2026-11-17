import 'server-only'
import type { DbExecutor } from '@/lib/db/executor'
import { BFF_JOB_PRIORITY, type BffJobKind, type BffJobPriority } from './types'
import { insertJob, insertJobIfAbsent } from './repository'
import { priorityName } from './task'
import { triggerBffJob } from './orchestrator'

export interface EnqueuedJob {
  jobId: string
}

export async function enqueueJob(
  input: {
    kind: BffJobKind
    organizationId: string
    payload: Record<string, unknown>
    priority?: BffJobPriority
    jobId?: string
    notBefore?: Date
  },
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
  await startRun({ jobId, kind: input.kind, organizationId: input.organizationId, priority, notBefore: input.notBefore })
  return { jobId }
}

export async function enqueueJobIfAbsent(
  input: {
    kind: BffJobKind
    organizationId: string
    payload: Record<string, unknown>
    jobId: string
    priority?: BffJobPriority
    notBefore?: Date
  },
  executor?: DbExecutor
): Promise<boolean> {
  const priority = input.priority ?? BFF_JOB_PRIORITY.bulk
  const added = await insertJobIfAbsent({ ...input, priority }, executor)
  if (added) await startRun({ jobId: input.jobId, kind: input.kind, organizationId: input.organizationId, priority, notBefore: input.notBefore })
  return added
}

async function startRun(job: { jobId: string; kind: BffJobKind; organizationId: string; priority: BffJobPriority; notBefore?: Date }): Promise<void> {
  const run = { job_id: job.jobId, kind: job.kind, organization_id: job.organizationId, priority: priorityName(job.priority), generation: 0 }
  await Promise.resolve()
    .then(() => triggerBffJob(run, job.notBefore ? { notBefore: job.notBefore } : {}))
    .catch((error: unknown) => {
      console.warn(`[jobs] ${job.kind} ${job.jobId} is stored but its run did not start; the dispatch sweep will start it:`, error)
    })
}
