import 'server-only'
import { ConcurrencyLimitStrategy, type HatchetClient } from '@hatchet-dev/typescript-sdk/v1'
import { hatchetClient } from '@/lib/jobs-queue/orchestrator'
import { failureText } from '@/lib/jobs-queue/task'
import { runAsJobSlice } from '@/lib/jobs-queue/slice-scope'
import { runWithTenantSlot, withPlatformAccess } from '@/lib/db/tenant-context'
import { fireTaskDefinition, repairSchedules } from './fire-definition'
import { OFFICE_TIME_ZONE } from '@/lib/format'
import { FIRE_TASK_DEFINITION, type FireTaskDefinitionInput } from './scheduled-runs'
import * as sweeps from './sweeps'

// Engine v0.114.2, 2026-11-11: crons honour a `CRON_TZ=<IANA zone> ` prefix (orchestrator.integration.spec.ts).
const FIRES_PER_ORGANIZATION = 5

export type TaskDeclarer = Pick<HatchetClient, 'task'>

function inWorkerScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenantSlot(() => runAsJobSlice(fn))
}

export async function reportingOnlyTheClass<T>(task: string, category: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    console.error(`[scheduling] ${task} failed:`, error)
    throw new Error(failureText(category, error))
  }
}

export interface SweepSpec {
  name: string
  cron: string
  reason: string
  run: () => Promise<unknown>
  retries?: number
}

export function sweepTask(hatchet: TaskDeclarer, spec: SweepSpec) {
  return hatchet.task({
    name: spec.name,
    on: { cron: spec.cron },
    concurrency: { expression: `'${spec.name}'`, maxRuns: 1, limitStrategy: ConcurrencyLimitStrategy.CANCEL_NEWEST },
    executionTimeout: '10m',
    retries: spec.retries ?? 0,
    backoff: { factor: 2, maxSeconds: 60 },
    fn: async () => {
      await reportingOnlyTheClass(spec.name, 'sweep-failed', () =>
        inWorkerScope(() => withPlatformAccess(`${spec.name}: ${spec.reason}`, spec.run)),
      )
    },
  })
}

const SWEEPS: SweepSpec[] = [
  {
    name: 'runs-reconcile',
    cron: '* * * * *',
    reason: 'claims the still-active task_runs of every organization nothing has checked recently; each is reconciled inside its own organization',
    run: sweeps.reconcileRuns,
  },
  {
    name: 'reconcile-background-work',
    cron: '* * * * *',
    reason: 'lists the documents, report filings and mail imports of every organization left without a live job; each is recovered inside its own organization',
    run: sweeps.reconcileBackgroundWork,
  },
  {
    name: 'inbound-mail-sweep',
    cron: '* * * * *',
    reason:
      'lists the project mail of every organization left half-done, running out or past its keep (ADR-0137); each row is ' +
      'finished inside its own organization, and only the rows past their keep are deleted as the platform role',
    run: sweeps.sweepProjectMail,
  },
  {
    name: 'upload-sweep',
    cron: '* * * * *',
    reason: 'lists the open upload batches and owed quarantine audits of every organization; each is settled inside its own organization',
    run: sweeps.sweepUploads,
  },
  {
    name: 'folder-placement-sweep',
    cron: '* * * * *',
    reason: 'lists the projects of every organization that restrict a folder; each is placed inside its own organization',
    run: sweeps.sweepPlacement,
  },
  {
    name: 'conversation-trace-erasure',
    cron: '* * * * *',
    reason: 'reads the deletion queue of every organization for erased chats whose Langfuse traces remain',
    run: sweeps.sweepConversationTraces,
  },
  {
    name: 'source-monitor',
    cron: '*/15 * * * *',
    reason:
      'reads the platform\'s published public sources whose monitor is due (ADR-0174); a changed source gets a draft ' +
      'change request for a reviewer, never a publish. Off unless the platform has source-monitors on',
    run: sweeps.sweepSourceMonitors,
  },
  {
    name: 'agent-ask-expiry',
    cron: '*/5 * * * *',
    reason:
      'lists the asks of every organization still open past the longest a chat turn runs (their outcome notice was lost); ' +
      'each is ended inside its own organization',
    run: sweeps.sweepLostAsks,
  },
  {
    name: 'schedule-repair',
    cron: '*/5 * * * *',
    reason: 'finds the task definitions of every organization whose due time passed without a fire, or that have no scheduled run',
    run: repairSchedules,
  },
  {
    name: 'task-runs-prune',
    cron: '41 * * * *',
    reason: 'deletes the task_runs of every organization past the retention window',
    run: sweeps.pruneTaskRuns,
  },
  {
    name: 'usage-export',
    cron: '*/10 * * * *',
    reason: 'sums the usage ledger of every organization per hour for PostHog; each budget snapshot is read inside its organization',
    run: sweeps.sweepUsageExport,
    retries: 2,
  },
  {
    name: 'trace-retention',
    cron: '17 2 * * *',
    reason: 'deletes the Langfuse traces of every organization older than the retention window',
    run: sweeps.sweepTraceRetention,
    retries: 3,
  },
  {
    name: 'download-log-retention',
    cron: '37 2 * * *',
    reason: 'deletes the download log entries of every organization past its retention',
    run: sweeps.sweepDownloadLogRetention,
    retries: 3,
  },
  {
    name: 'collaboration-retention',
    cron: '23 * * * *',
    reason:
      'deletes the inbox items of every organization past their retention, and the grants, mention requests and inbox ' +
      'items of every organization whose conversation or document is gone',
    run: sweeps.sweepCollaborationRetention,
  },
  {
    name: 'platform-lessons-sweep',
    cron: '53 * * * *',
    reason: 'the lesson pipeline distills reports from every tenant into anonymized fleet-wide lessons',
    run: sweeps.sweepPlatformLessons,
  },
  {
    name: 'frist-reminder',
    cron: `CRON_TZ=${OFFICE_TIME_ZONE} 45 6 * * *`,
    reason: 'one grouped read of the organizations with a mark whose Frist is near or past; each job is enqueued inside its own organization',
    run: sweeps.sweepFristReminder,
    retries: 3,
  },
  {
    name: 'base-knowledge-new-editions',
    cron: `CRON_TZ=${OFFICE_TIME_ZONE} 13 5 * * *`,
    reason:
      'lists the organizations holding confirmed standards of their own; each resolves inside its own organization which ' +
      'edition binds for its active projects and tells whoever manages its office shelf when its copy no longer does',
    run: sweeps.sweepNewEditions,
    retries: 2,
  },
  {
    name: 'office-norms-scan',
    cron: `CRON_TZ=${OFFICE_TIME_ZONE} 13 4 * * *`,
    reason:
      'lists the organizations and, for each with office-standards on, queues inside it the scan of its office shelf ' +
      'folders for norms not yet under Normen & Richtlinien; the flag is switched in WorkOS, which tells us nothing',
    run: sweeps.sweepNormsInFolders,
    retries: 2,
  },
]

export function fireTask(hatchet: TaskDeclarer) {
  return hatchet.task({
    name: FIRE_TASK_DEFINITION,
    concurrency: {
      expression: 'input.organization_id',
      maxRuns: FIRES_PER_ORGANIZATION,
      limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
    },
    executionTimeout: '5m',
    retries: 0,
    fn: async (input: FireTaskDefinitionInput) => {
      const outcome = await reportingOnlyTheClass(FIRE_TASK_DEFINITION, 'fire-failed', () => inWorkerScope(() => fireTaskDefinition(input)))
      return { fired: outcome.fired, reason: outcome.reason ?? '' }
    },
  })
}

export function schedulingTasks(hatchet: TaskDeclarer = hatchetClient()) {
  return [fireTask(hatchet), ...SWEEPS.map((spec) => sweepTask(hatchet, spec))]
}
