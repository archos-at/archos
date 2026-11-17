/**
 * The maintenance sweeps, as functions the `bff-jobs` worker's Hatchet cron
 * tasks call in process (ADR-0150, `./tasks.ts`). Each runs a BFF function
 * under the platform scope the task wrapper opens, and logs only when it
 * changed something.
 *
 * A failure throws. Hatchet records it on the run, with its attempt and error
 * class; the next cron run tries again.
 */

import 'server-only'
import { endLostAsks } from '@/lib/agent-asks/service'
import { exportUsageToPosthog } from '@/lib/analytics/usage-export'
import { enqueueDueReminders } from '@/lib/annotations/due-reminders'
import { sweepOrphanedCollaborationRows } from '@/lib/collaboration/cleanup'
import { pruneExpiredInboxItems } from '@/lib/collaboration/retention'
import { reconcileStalePending } from '@/lib/documents/stale-pending'
import { recoverStuckProcessing } from '@/lib/documents/stuck-processing'
import { sweepInboundMail, type InboundMailSweepResult, type SweepCounts } from '@/lib/inbound-mail/sweep'
import { sweepStaleMailImports } from '@/lib/mail-import/job'
import { runScheduledLessonSweep } from '@/lib/platform-lessons/service'
import { sweepCollectionPlacement } from '@/lib/projects/placement-sweep'
import { reconcileStaleRuns } from '@/lib/runs/reconcile'
import { recoverStuckFilings } from '@/lib/tasks/filing-sweep'
import { sweepUploadBatches } from '@/lib/upload-batches/sweep'
import { createSql } from '../../workers/app-database.js'
import {
  createTraceClient,
  deleteTracesBefore,
  eraseSessionTraces,
  readLangfuseConfig,
  readTraceRetentionDays,
} from '../../workers/langfuse-traces.js'
import {
  conversationExists,
  conversationIsHeld,
  findConversationsAwaitingTraceErasure,
  markConversationTracesErased,
  pruneDownloadLog,
  pruneOldRuns,
} from '../../workers/maintenance-sql.js'
import { report } from './log'
import { runSourceMonitor } from '@/lib/base-knowledge/platform/monitor'

const DAY_MS = 24 * 60 * 60 * 1000
/** Most rounds one run of a sweep that drains a backlog takes; the next cron run continues. */
const MAX_ROUNDS = 20

let sql: ReturnType<typeof createSql> | null = null
/** The worker's one postgres.js client for the cross-tenant SQL in `workers/maintenance-sql.js`. */
const maintenanceSql = (): ReturnType<typeof createSql> => (sql ??= createSql())

/** Close what the documents, filings and mail imports left half-done, and settle the stale pending documents (ADR-0079). */
export async function reconcileBackgroundWork(): Promise<void> {
  const parts = await Promise.allSettled([
    recoverStuckProcessing(),
    recoverStuckFilings(),
    sweepStaleMailImports(),
    reconcileStalePending(),
  ])
  // Every part ran, so one that threw costs the others nothing; it fails the run only now.
  const failed = parts.find((part) => part.status === 'rejected')
  const [documents, filings] = parts
  if (documents.status === 'fulfilled' && (documents.value.requeued > 0 || documents.value.failed > 0)) {
    report(`background work, documents: ${JSON.stringify(documents.value)}`)
  }
  if (filings.status === 'fulfilled' && (filings.value.filed > 0 || filings.value.failed > 0)) {
    report(`background work, report filings: ${JSON.stringify(filings.value)}`)
  }
  if (failed) throw failed.reason
}

/**
 * Project mail's sweeps (ADR-0137, `lib/inbound-mail/sweep.ts`), in their
 * order. One line per sweep that acted or saw an error, counts by name, never
 * an id or an address. A sweep that threw whole fails the run, after every
 * other sweep ran; a row that failed is only counted, and the next run tries it
 * again. What Hatchet is told is the class (`reportingOnlyTheClass`).
 */
export async function sweepProjectMail(now: Date = new Date()): Promise<void> {
  const result = await sweepInboundMail(now)
  for (const line of projectMailLines(result)) report(line)
  const failed = sweepEntries(result).filter(([, counts]) => (counts.failed ?? 0) > 0)
  if (failed.length > 0) throw new Error(`project mail sweeps failed: ${failed.map(([name]) => name).join(', ')}`)
}

const sweepEntries = (result: InboundMailSweepResult) => Object.entries(result) as Array<[string, SweepCounts]>

/** The log lines of one run of project mail's sweeps: a sweep that only looked says nothing. */
export function projectMailLines(result: InboundMailSweepResult): string[] {
  const lines: string[] = []
  for (const [sweep, counts] of sweepEntries(result)) {
    const acted = Object.entries(counts).some(([name, value]) => name !== 'checked' && value > 0)
    if (!acted) continue
    const parts = Object.entries(counts).map(([name, value]) => `${name} ${value}`)
    lines.push(`project mail ${sweep}: ${parts.join(', ')}`)
  }
  return lines
}

/** End the asks of every organization whose turn never reported its end, by the rule a read applies (`endLostAsks`). */
export async function sweepLostAsks(): Promise<void> {
  const ended = await endLostAsks()
  if (ended > 0) report(`agent asks: ended ${ended} ask(s) whose turn never reported its end`)
}

export async function reconcileRuns(): Promise<void> {
  const counts = await reconcileStaleRuns()
  if (counts.closed > 0 || counts.healed > 0 || counts.failed > 0) report(`run reconcile: ${JSON.stringify(counts)}`)
}

export async function sweepUploads(): Promise<void> {
  const counts = await sweepUploadBatches(new Date())
  if (counts.sealed > 0 || counts.completed > 0 || counts.failed > 0 || counts.audited > 0) {
    report(`upload sweep: ${JSON.stringify(counts)}`)
  }
}

/** The public-source monitor (ADR-0174): opens a change request for a changed source; off behind `source-monitors`. */
export async function sweepSourceMonitors(): Promise<void> {
  const outcome = await runSourceMonitor()
  if (outcome.run && (outcome.run.changed > 0 || outcome.run.failed > 0 || outcome.run.opened > 0)) {
    const { checked, changed, failed, opened } = outcome.run
    report(`source monitor: ${JSON.stringify({ checked, changed, failed, opened })}`)
  }
}

export async function sweepPlacement(): Promise<void> {
  const counts = await sweepCollectionPlacement()
  if (counts.moved > 0 || counts.pending > 0 || counts.failed > 0) report(`folder placement sweep: ${JSON.stringify(counts)}`)
}

/** Run-history retention: `task_runs` older than `SKILL_RUNS_RETENTION_DAYS` (default 90). */
export async function pruneTaskRuns(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const parsed = Number.parseInt(env.SKILL_RUNS_RETENTION_DAYS ?? '', 10)
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 90
  const pruned = await pruneOldRuns(maintenanceSql(), days)
  if (pruned > 0) report(`pruned ${pruned} task_runs older than ${days} days`)
}

/**
 * Langfuse trace retention (ADR-0044): delete the traces older than
 * `TRACE_RETENTION_DAYS`, a bounded number of batches per run, so a backlog
 * drains over days. Not configured is a no-op.
 */
export async function sweepTraceRetention(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<void> {
  const { config } = readLangfuseConfig(env)
  if (!config) return
  const { days } = readTraceRetentionDays(env)
  const cutoff = new Date(now.getTime() - days * DAY_MS)
  const result = await deleteTracesBefore(createTraceClient(config), cutoff)
  report(
    `trace retention: asked Langfuse to delete ${result.traces} trace(s) older than ${days} days in ${result.batches} batch(es)` +
      (result.capped ? '; more remain, the next run continues' : ''),
  )
}

/** The chats erased per run, and how long a run may take. */
const CONVERSATION_TRACES_PER_RUN = 100
const CONVERSATION_TRACES_BUDGET_MS = 120_000

/**
 * Erase the Langfuse traces of the chats that are erased and still have them
 * (`findConversationsAwaitingTraceErasure`: erased within 35 days, at least 15
 * minutes ago, not stamped, not under a legal hold). That is a chat the BFF
 * erased in the delete request, which the purger never sees, and a chat whose
 * queue row ended `failed` after the chat itself was erased: the purger's trace
 * step failed on every attempt, and nothing else would go back for them. The
 * hold is asked again right before each deletion, and for a `failed` row so is
 * whether the chat is really gone; each erased chat is stamped so it is done
 * once, and such a `failed` row is closed `purged`. Not configured is a no-op.
 */
export async function sweepConversationTraces(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { config } = readLangfuseConfig(env)
  if (!config) return
  const db = maintenanceSql()
  const started = Date.now()
  const client = createTraceClient(config)
  let erased = 0
  for (const row of await findConversationsAwaitingTraceErasure(db, CONVERSATION_TRACES_PER_RUN)) {
    if (Date.now() - started >= CONVERSATION_TRACES_BUDGET_MS) break
    if (await conversationIsHeld(db, row)) continue
    if (row.status === 'failed' && (await conversationExists(db, row))) continue
    await eraseSessionTraces(client, row.entity_id)
    await markConversationTracesErased(db, row.id)
    erased += 1
  }
  if (erased > 0) report(`conversation trace erasure: asked Langfuse to delete the traces of ${erased} erased chat(s)`)
}

/** The download log's retention (migration 0114), in bounded rounds until nothing is left to cap on. */
export async function sweepDownloadLogRetention(): Promise<void> {
  let deleted = 0
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await pruneDownloadLog(maintenanceSql())
    deleted += result.deleted
    if (!result.capped) break
  }
  if (deleted > 0) report(`download log retention: deleted ${deleted} entries past retention`)
}

/**
 * Collaboration retention: the inbox items past their type's keep (spec IB-15,
 * `lib/collaboration/retention.ts`) and the grants, mention requests and inbox
 * items whose conversation or document is gone (`sweepOrphanedCollaborationRows`:
 * no foreign key can cascade into a polymorphic target, and the purger's own
 * cascade is a second statement of it). Each call deletes one batch per table,
 * so this asks again until a round finds nothing, up to a bound.
 */
export async function sweepCollaborationRetention(): Promise<void> {
  const deleted = { expired: 0, grants: 0, requests: 0, inboxItems: 0 }
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const [retention, orphans] = await Promise.all([pruneExpiredInboxItems(), sweepOrphanedCollaborationRows()])
    if (retention.deleted + orphans.grants + orphans.requests + orphans.inboxItems === 0) break
    deleted.expired += retention.deleted
    deleted.grants += orphans.grants
    deleted.requests += orphans.requests
    deleted.inboxItems += orphans.inboxItems
  }
  if (Object.values(deleted).some((count) => count > 0)) report(`collaboration retention: ${JSON.stringify(deleted)}`)
}

/**
 * The platform lessons' clock (`lib/platform-lessons/service.ts`). A down-vote
 * kicks distillation from the request (`after()`), which a pod that dies loses,
 * and the register's upkeep (retiring a lesson that stayed quiet, expiring old
 * candidates, re-embedding) is due by date, not by vote. One bounded sweep.
 */
export async function sweepPlatformLessons(): Promise<void> {
  const result = await runScheduledLessonSweep()
  if (result.processed > 0) report(`platform lessons: ${JSON.stringify(result)}`)
}

/**
 * The daily Frist reminder: queue one job per organization with marks due
 * (`enqueueDueReminders`). The task's cron is 06:45 on the office's clock
 * (`./tasks.ts`, `CRON_TZ`). A repeat the same day, a retry or a run somebody
 * triggers by hand, queues nothing new, because each job's id is the
 * organization and the office's day.
 */
export async function sweepFristReminder(now: Date = new Date()): Promise<void> {
  const counts = await enqueueDueReminders(now)
  if (counts.queued > 0) report(`Frist reminder for ${counts.day}: ${JSON.stringify(counts)}`)
}

/** The PostHog usage export; while it is behind on history, it asks again at once, up to a bound. */
export async function sweepUsageExport(): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const counts = await exportUsageToPosthog()
    if (counts.usage) report(`PostHog usage export: ${counts.usage.rows} hourly row(s) from ${counts.usage.from} to ${counts.usage.to}`)
    if (!counts.usage || counts.usage.caughtUp) return
  }
}
