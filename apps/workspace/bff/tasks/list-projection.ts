import 'server-only'
import { TASK_PAGE_MAX_LIMIT, type TaskRunSummary, type TaskRunView } from './task-wire'
import { listRunLedgersByMessageIds } from '@/lib/conversations/repository'
import type { TaskRun } from '@/lib/db/schema/task-model'
import { sanitizeRunLedger } from '@/lib/runs/run-ledger'
import type { RunLedger } from '@/lib/runs/run-ledger-types'
import { runDisplayStatus, runTallies } from '@/lib/runs/run-vocabulary'

export function toTaskRunView(
  task: TaskRun,
  requesterName: string | null,
  runSummary: TaskRunSummary | null = null,
): TaskRunView {
  return {
    id: task.id,
    taskId: task.definitionId,
    kind: task.kind,
    title: task.title,
    goal: task.plan.goal?.trim() || null,
    status: task.status,
    review: task.review ?? null,
    reviewReason: task.reviewReason,
    filedDocumentId: task.filedDocumentId,
    conversationId: task.conversationId,
    runMessageId: task.runMessageId,
    trigger: task.trigger,
    requesterUserId: task.requesterUserId,
    requesterName,
    createdAt: task.createdAt.toISOString(),
    finishedAt: task.finishedAt?.toISOString() ?? null,
    error: task.error,
    runSummary,
  }
}

export function runSummaryOf(ledger: RunLedger | null): TaskRunSummary | null {
  if (!ledger) return null
  const { rounds, docs } = runTallies(ledger)
  return { status: runDisplayStatus(ledger), rounds, docs }
}

export async function loadRunSummaries(runs: readonly TaskRun[]): Promise<Map<string, TaskRunSummary>> {
  const messageIdByRun = new Map<string, string>()
  for (const run of runs.slice(0, TASK_PAGE_MAX_LIMIT)) {
    if (run.runMessageId) messageIdByRun.set(run.id, run.runMessageId)
  }
  if (messageIdByRun.size === 0) return new Map()

  const ledgers = await listRunLedgersByMessageIds([...messageIdByRun.values()])
  const summaries = new Map<string, TaskRunSummary>()
  for (const [runId, messageId] of messageIdByRun) {
    const summary = runSummaryOf(sanitizeRunLedger(ledgers.get(messageId)))
    if (summary) summaries.set(runId, summary)
  }
  return summaries
}
