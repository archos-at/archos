/**
 * Two writes of `task_runs` that `./repository` has no room for (it is held at
 * its size by `ci/size_baseline.json`): what the submit records on a run, and
 * the kill switch's claim. Both follow `TASK_RUN_LIFECYCLE` (ADR-0179).
 */

import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { messages } from '@/lib/db/schema/messages'
import { taskRuns, type TaskRun } from '@/lib/db/schema/task-model'
import { TASK_RUN_LIFECYCLE } from './task-vocabulary'

/** What a submit learned about its run once the backend took the job. */
export interface RunSubmission {
  /** What the run is now, as far as the submit knows (`submittedRunStatus`). */
  status: 'queued' | 'running'
  backendJobId: string
  conversationId: string | null
  runMessageId: string | null
}

/**
 * Record what the submit returned, and move the status only as the lifecycle
 * allows.
 *
 * The three references are written whatever the row says: the reconciler asks
 * the job store by the backend job id, and the heal finds the block by the
 * message, for an ended run as much as for a live one. The status is another
 * matter. The submit takes seconds, and by the time it returns the worker's
 * first flush may have started the run and the kill switch may have ended it.
 * So the only move made here is `start`, from the states the lifecycle starts
 * a run from: a submit that says `running` moves a `queued` row, and one that
 * says `queued` moves nothing, because the row was born queued. An ended row
 * keeps its ending and a running one is never put back.
 *
 * Null when the run is not this organization's.
 */
export async function recordSubmission(
  runId: string,
  organizationId: string,
  submission: RunSubmission,
): Promise<TaskRun | null> {
  const startable = inArray(taskRuns.status, [...TASK_RUN_LIFECYCLE.sourcesOf('start')])
  const starts = submission.status === 'running'
  const [row] = await getDb()
    .update(taskRuns)
    .set({
      backendJobId: submission.backendJobId,
      conversationId: submission.conversationId,
      runMessageId: submission.runMessageId,
      ...(starts
        ? {
            status: sql`CASE WHEN ${startable} THEN 'running' ELSE ${taskRuns.status} END`,
            startedAt: sql`CASE WHEN ${startable} THEN now() ELSE ${taskRuns.startedAt} END`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.organizationId, organizationId)))
    .returning()
  return row ?? null
}

/**
 * Claim up to `limit` active runs for the kill switch to close as
 * interrupted, and stamp them checked, across every organization.
 *
 * Every active run but one kind: a run whose block already reads `done` has
 * nothing left to interrupt. Its worker stored the report and told the block
 * so; only the outcome report that closes the row is missing, still on its way
 * or lost. Closing that row `interrupted` would make the row contradict the
 * block and drop the worker's success when it arrives, so it is left for that
 * report, and for the reconciler when the report never comes: it asks the job
 * store, and where the job is gone too it believes the block
 * (`lib/runs/reconcile.ts`).
 *
 * The same statement shape as `claimRunsToReconcile`: `FOR UPDATE SKIP LOCKED`
 * keeps two presses off one row. NOT tenant-filtered: the caller runs this
 * under platform access and closes each run inside its own organization.
 */
export async function claimRunsToInterrupt(limit: number): Promise<TaskRun[]> {
  const db = getDb()
  const blockReadsDone = sql`EXISTS (
    SELECT 1 FROM ${messages}
    WHERE ${messages.id} = ${taskRuns.runMessageId}
      AND ${messages.organizationId} = ${taskRuns.organizationId}
      AND ${messages.metadata} -> 'run_ledger' ->> 'status' = 'done'
  )`
  const due = db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(and(inArray(taskRuns.status, [...TASK_RUN_LIFECYCLE.liveStates]), sql`NOT ${blockReadsDone}`))
    .orderBy(sql`COALESCE(${taskRuns.startedAt}, ${taskRuns.createdAt})`)
    .limit(limit)
    .for('update', { skipLocked: true })
  return db
    .update(taskRuns)
    .set({ reconcileCheckedAt: sql`now()` })
    .where(inArray(taskRuns.id, due))
    .returning()
}
