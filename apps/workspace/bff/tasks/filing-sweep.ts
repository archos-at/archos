import 'server-only'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { findFiledResearchReport } from '@/lib/documents/research-report'
import { findDeadJob, findOpenJobId } from '@/lib/jobs-queue/repository'
import type { TaskRun } from '@/lib/db/schema/task-model'
import * as repository from './repository'

export const FILING_STUCK_AFTER_MINUTES = 15

export const FILING_BATCH = 50

export interface StuckFilingSweepResult {
  checked: number
  filed: number
  failed: number
  waiting: number
  settled: number
  errors: number
}

type Verdict = 'filed' | 'failed' | 'waiting' | 'settled'

async function judge(run: TaskRun): Promise<Verdict> {
  const runId = run.backendJobId
  const query = { kind: 'file_research_report', organizationId: run.organizationId, matching: { runId: runId ?? '' } }
  if (runId && (await findOpenJobId(query))) return 'waiting'

  const filed = runId
    ? await findFiledResearchReport({ organizationId: run.organizationId, projectId: run.projectId, runId })
    : null
  if (filed) {
    const written = await repository.settleQueuedFiling(run.id, run.organizationId, {
      filingStatus: 'filed',
      filingDetail: null,
      filedDocumentId: filed.documentId,
    })
    return written ? 'filed' : 'settled'
  }

  const dead = runId ? await findDeadJob(query) : null
  const detail = dead
    ? `the filing job failed every attempt: ${dead.lastError ?? 'no reason kept'}`
    : 'the filing job is gone and the report was never filed'
  const written = await repository.settleQueuedFiling(run.id, run.organizationId, {
    filingStatus: 'failed',
    filingDetail: detail.slice(0, 500),
    filedDocumentId: null,
  })
  return written ? 'failed' : 'settled'
}

export async function recoverStuckFilings(
  now: Date = new Date(),
  options: { staleMinutes?: number; batch?: number } = {}
): Promise<StuckFilingSweepResult> {
  const before = new Date(now.getTime() - (options.staleMinutes ?? FILING_STUCK_AFTER_MINUTES) * 60_000)
  const runs = await withPlatformAccess('filing sweep: finding report filings still queued after a quarter hour', () =>
    repository.listRunsWithStaleQueuedFiling(before, options.batch ?? FILING_BATCH)
  )

  const result: StuckFilingSweepResult = { checked: runs.length, filed: 0, failed: 0, waiting: 0, settled: 0, errors: 0 }
  for (const run of runs) {
    try {
      const verdict = await withTenant({ organizationId: run.organizationId }, () => judge(run))
      result[verdict] += 1
    } catch (error) {
      console.error('[runs] could not judge the queued filing of run', run.id, error)
      result.errors += 1
    }
  }
  return result
}
