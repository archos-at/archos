/**
 * The platform kill switch: stop every running deep research and close its run.
 *
 * Two halves, in this order:
 *
 *  1. The job store (`killActiveBackendJobs`). Every submitted or running job is
 *     written INTERRUPTED, its queue row dropped, and a running worker's `CancellationMonitor` sees the
 *     status and stops. The backend reports each verdict to
 *     `/api/internal/jobs/{id}/outcome`, which closes most `task_runs` rows
 *     before this call returns.
 *  2. The runs the report could not reach: a row with no backend job id, a
 *     report that was lost, a job that had already vanished from the store.
 *     The kill switch closes as `interrupted` only what it stopped: a row with
 *     no job id (nothing can run for it), and a row whose job the backend just
 *     answered it killed. That goes through the one recorder, with
 *     `onlyIfActive`, so a row the report closed a moment ago is left alone
 *     and its requester hears once. Every other row still active has a job the
 *     kill did not stop, and the job store knows why, so the row goes down the
 *     reconciler's own path (`reconcileRunWithEnding`) and the store's verdict
 *     closes it. The case that matters: a job that had already succeeded when
 *     the kill ran (the backend counts it as already finished) while its
 *     worker's outcome report was still on its way. Closed `interrupted`, that
 *     row dropped the success when it arrived and the report was never filed;
 *     now it closes `succeeded` and files. A job the store still holds as
 *     running (its kill failed, or it lay past the batch) keeps its row live,
 *     which is true, and a job the store no longer has waits out the
 *     reconciler's grace. One kind of row is not claimed at all: a run whose
 *     block already reads `done` (`claimRunsToInterrupt`).
 *
 * If the first half fails, the second does not run: closing the rows of jobs
 * that are still working would show them as stopped while they spend tokens.
 */

import 'server-only'
import type { TaskRun } from '@/lib/db/schema/task-model'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { killActiveBackendJobs } from '@/lib/jobs/backend-client'
import { claimRunsToInterrupt } from '@/lib/tasks/run-moves'
import { recordRunOutcome } from '@/lib/tasks/service'
import { readReconcileConfig, reconcileRunWithEnding } from './reconcile'

/** Shown to the requester on the run's block and in the Aufträge list. */
export const KILLED_REASON = 'Der Lauf wurde von der Plattform-Administration abgebrochen.'

/** How many still-active rows one press closes. A larger backlog is closed by pressing again. */
export const KILL_RUN_BATCH = 500
const KILL_CONCURRENCY = 5

export interface KillAllResult {
  /** Jobs the job store held as submitted or running. */
  jobsFound: number
  jobsKilled: number
  /** Jobs that finished on their own while the kill ran; their verdict stands. */
  jobsAlreadyFinished: number
  /** Active run rows this tier closed as interrupted itself, after the backend's reports. */
  runsClosed: number
  /**
   * Active run rows whose job the kill did not stop, closed by the job store's
   * own verdict: the run had succeeded, or failed, before the kill reached it.
   */
  runsSucceeded: number
  runsFailed: number
  /** Rows left live for the reconciler: the store holds the job as running, cannot be asked, or has lost it. */
  runsWaiting: number
  failures: { id: string; error: string }[]
  /** Either half hit its batch bound; press again for the rest. */
  truncated: boolean
}

/** How one claimed row ended, or that it did not. */
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
  // The ids whose INTERRUPTED the backend wrote in this press. A job it could
  // not stop cleanly is not among them even where the status was written; the
  // store is asked about that one like any other, and answers interrupted.
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
