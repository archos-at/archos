import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { messages } from '@/lib/db/schema/messages'
import { taskRuns, type TaskRun } from '@/lib/db/schema/task-model'
import { TASK_RUN_LIFECYCLE } from './task-vocabulary'

export interface RunSubmission {
  status: 'queued' | 'running'
  backendJobId: string
  conversationId: string | null
  runMessageId: string | null
}

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
