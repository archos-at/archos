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
const MAX_ROUNDS = 20

let sql: ReturnType<typeof createSql> | null = null
const maintenanceSql = (): ReturnType<typeof createSql> => (sql ??= createSql())

export async function reconcileBackgroundWork(): Promise<void> {
  const parts = await Promise.allSettled([
    recoverStuckProcessing(),
    recoverStuckFilings(),
    sweepStaleMailImports(),
    reconcileStalePending(),
  ])
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

export async function sweepProjectMail(now: Date = new Date()): Promise<void> {
  const result = await sweepInboundMail(now)
  for (const line of projectMailLines(result)) report(line)
  const failed = sweepEntries(result).filter(([, counts]) => (counts.failed ?? 0) > 0)
  if (failed.length > 0) throw new Error(`project mail sweeps failed: ${failed.map(([name]) => name).join(', ')}`)
}

const sweepEntries = (result: InboundMailSweepResult) => Object.entries(result) as Array<[string, SweepCounts]>

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

export async function pruneTaskRuns(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const parsed = Number.parseInt(env.SKILL_RUNS_RETENTION_DAYS ?? '', 10)
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 90
  const pruned = await pruneOldRuns(maintenanceSql(), days)
  if (pruned > 0) report(`pruned ${pruned} task_runs older than ${days} days`)
}

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

const CONVERSATION_TRACES_PER_RUN = 100
const CONVERSATION_TRACES_BUDGET_MS = 120_000

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

export async function sweepDownloadLogRetention(): Promise<void> {
  let deleted = 0
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await pruneDownloadLog(maintenanceSql())
    deleted += result.deleted
    if (!result.capped) break
  }
  if (deleted > 0) report(`download log retention: deleted ${deleted} entries past retention`)
}

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

export async function sweepPlatformLessons(): Promise<void> {
  const result = await runScheduledLessonSweep()
  if (result.processed > 0) report(`platform lessons: ${JSON.stringify(result)}`)
}

export async function sweepFristReminder(now: Date = new Date()): Promise<void> {
  const counts = await enqueueDueReminders(now)
  if (counts.queued > 0) report(`Frist reminder for ${counts.day}: ${JSON.stringify(counts)}`)
}

export async function sweepUsageExport(): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const counts = await exportUsageToPosthog()
    if (counts.usage) report(`PostHog usage export: ${counts.usage.rows} hourly row(s) from ${counts.usage.from} to ${counts.usage.to}`)
    if (!counts.usage || counts.usage.caughtUp) return
  }
}
