/**
 * The scheduling tasks the `bff-jobs` worker registers with Hatchet (ADR-0150),
 * in place of the scheduler container that ticked every 30 s.
 *
 *   - `fire-task-definition`: a definition's scheduled run fires it
 *     (`./fire-definition.ts`). Fair across offices: `GROUP_ROUND_ROBIN` on
 *     `input.organization_id`. No retries: a fire is at most once, and a retry
 *     would find the occurrence already taken anyway.
 *   - one cron task per maintenance sweep (`./sweeps.ts`), each with a constant
 *     concurrency key, `maxRuns: 1` and `CANCEL_NEWEST`: a run that comes due
 *     while the previous one is still going is dropped, so two never overlap.
 *
 * Hatchet crons have minute granularity and are UTC. The sweeps that ticked
 * every 30 s now run every minute; the daily ones run at a fixed UTC time, and
 * the one sweep tied to the office's clock (the Frist reminder) runs hourly and
 * gates itself (`./office-clock.ts`).
 *
 * The worker passes `await schedulingTasks()` to `hatchet.worker('bff-jobs', { workflows })`.
 */

import 'server-only'
import { ConcurrencyLimitStrategy } from '@hatchet-dev/typescript-sdk/v1'
import { runAsJobSlice } from '@/lib/jobs-queue/slice-scope'
import { runWithTenantSlot, withPlatformAccess } from '@/lib/db/tenant-context'
import { fireTaskDefinition, repairOverdueSchedules } from './fire-definition'
import { schedulingHatchet, type SchedulingHatchet } from './hatchet'
import { FIRE_TASK_DEFINITION, type FireTaskDefinitionInput } from './scheduled-runs'
import * as sweeps from './sweeps'

/** How many definitions of one organization fire at once. */
const FIRES_PER_ORGANIZATION = 5

/** Like a job slice: no request, no tenant inherited from the run before (`slice-scope.ts`). */
function inWorkerScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenantSlot(() => runAsJobSlice(fn))
}

export interface SweepSpec {
  name: string
  /** A 5-field UTC cron. */
  cron: string
  /** Why the sweep reads every organization: its route's `crossTenant` declaration, kept. */
  reason: string
  run: () => Promise<unknown>
  retries?: number
}

/** A maintenance sweep as a Hatchet cron task that never overlaps itself. */
export function sweepTask(hatchet: SchedulingHatchet, spec: SweepSpec) {
  return hatchet.task({
    name: spec.name,
    on: { cron: spec.cron },
    concurrency: { expression: `'${spec.name}'`, maxRuns: 1, limitStrategy: ConcurrencyLimitStrategy.CANCEL_NEWEST },
    executionTimeout: '10m',
    retries: spec.retries ?? 0,
    backoff: { factor: 2, maxSeconds: 60 },
    fn: async () => {
      await inWorkerScope(() => withPlatformAccess(`${spec.name}: ${spec.reason}`, spec.run))
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
    name: 'schedule-repair',
    cron: '*/5 * * * *',
    reason: 'finds the task definitions of every organization whose due time passed without a fire',
    run: repairOverdueSchedules,
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
    name: 'frist-reminder',
    cron: '45 * * * *',
    reason: 'one grouped read of the organizations with a mark whose Frist is near or past; each job is enqueued inside its own organization',
    run: sweeps.sweepFristReminder,
    // Retries land seconds later, still inside the office's 06:45 hour.
    retries: 3,
  },
]

/** The task a definition's scheduled run fires. */
export function fireTask(hatchet: SchedulingHatchet) {
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
      const outcome = await inWorkerScope(() => fireTaskDefinition(input))
      return { fired: outcome.fired, reason: outcome.reason ?? '' }
    },
  })
}

function declareAll(hatchet: SchedulingHatchet) {
  return [fireTask(hatchet), ...SWEEPS.map((spec) => sweepTask(hatchet, spec))]
}

let declared: Promise<ReturnType<typeof declareAll>> | null = null

/** Every scheduling task, declared once per process, for `hatchet.worker('bff-jobs', { workflows })`. */
export function schedulingTasks(): Promise<ReturnType<typeof declareAll>> {
  declared ??= schedulingHatchet().then(declareAll)
  return declared
}
