import 'server-only'
import type { TaskRun } from '@/lib/db/schema/task-model'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { killActiveBackendJobs } from '@/lib/jobs/backend-client'
import { claimRunsToInterrupt } from '@/lib/tasks/run-moves'
import { recordRunOutcome } from '@/lib/tasks/service'
import { readReconcileConfig, reconcileRunWithEnding } from './reconcile'

export const KILLED_REASON = 'Der Lauf wurde von der Plattform-Administration abgebrochen.'

export const KILL_RUN_BATCH = 500
const KILL_CONCURRENCY = 5

export interface KillAllResult {
  jobsFound: number
  jobsKilled: number
  jobsAlreadyFinished: number
  runsClosed: number
  runsSucceeded: number
  runsFailed: number
  runsWaiting: number
  failures: { id: string; error: string }[]
  truncated: boolean
}

type RowEnding = 'interrupted' | 'succeeded' | 'failed' | 'waiting' | 'already-closed'

const ENDING_OF = { interrupted: 'interrupted', success: 'succeeded', failure: 'failed' } as const

async function closeRun(run: TaskRun, stoppedHere: boolean, now: Date): Promise<RowEnding> {
  return withTenant({ organizationId: run.organizationId }, async () => {
    if (stoppedHere) {
      const recorded = await recordRunOutcome(run, { status: 'interrupted', error: KILLED_REASON }, { onlyIfActive: true })
      return recorded.closed ? 'interrupted' : 'already-closed'
    }
    const { verdict, ending } = await reconcileRunWithEnding(run, readReconcileConfig(), now)
    if (verdict === 'closed' && ending) return ENDING_OF[ending]
    return verdict === 'waiting' ? 'waiting' : 'already-closed'
  })
}

export async function killAllActiveRuns(now: Date = new Date()): Promise<KillAllResult> {
  const backend = await killActiveBackendJobs()

  const claimed = await withPlatformAccess(
    'platform kill switch: finding the still-active runs of every organization',
    () => claimRunsToInterrupt(KILL_RUN_BATCH),
  )

  const result: KillAllResult = {
    jobsFound: backend.found,
    jobsKilled: backend.killed.length,
    jobsAlreadyFinished: backend.alreadyFinished,
    runsClosed: 0,
    runsSucceeded: 0,
    runsFailed: 0,
    runsWaiting: 0,
    failures: backend.failed.map((f) => ({ id: f.jobId, error: f.error })),
    truncated: backend.truncated || claimed.length >= KILL_RUN_BATCH,
  }
  const killed = new Set(backend.killed)
  for (let i = 0; i < claimed.length; i += KILL_CONCURRENCY) {
    const slice = claimed.slice(i, i + KILL_CONCURRENCY)
    await Promise.all(
      slice.map(async (run) => {
        try {
          const ending = await closeRun(run, !run.backendJobId || killed.has(run.backendJobId), now)
          if (ending === 'interrupted') result.runsClosed += 1
          else if (ending === 'succeeded') result.runsSucceeded += 1
          else if (ending === 'failed') result.runsFailed += 1
          else if (ending === 'waiting') result.runsWaiting += 1
        } catch (error) {
          console.error('[runs] kill switch: run', run.id, 'could not be closed', error)
          result.failures.push({ id: run.id, error: error instanceof Error ? error.message : String(error) })
        }
      }),
    )
  }
  return result
}
