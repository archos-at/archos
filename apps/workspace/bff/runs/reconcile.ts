import 'server-only'
import type { TaskRun } from '@/lib/db/schema/task-model'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { fetchBackendJobOutcome, type BackendJobOutcome } from '@/lib/jobs/backend-client'
import * as taskRepository from '@/lib/tasks/repository'
import { recordRunOutcome, type TaskOutcome } from '@/lib/tasks/service'
import { endingOfClosedRun } from './run-ending'
import { runDisplayStatus } from './run-vocabulary'
import { readRunMessage, settleRunLedger, writeRunReport } from './service'

export { endingOfClosedRun }

export const RECONCILE_BATCH = 25
export const HEAL_BATCH = 100
const RECONCILE_CONCURRENCY = 5

const DEFAULT_STALE_MINUTES = 10
const DEFAULT_UNKNOWN_GRACE_MINUTES = 120

export const LOST_JOB_REASON =
  'Der Lauf ist im Hintergrunddienst nicht mehr auffindbar; sein Ergebnis ließ sich nicht wiederherstellen.'
export const NEVER_SUBMITTED_REASON =
  'Der Lauf hat den Hintergrunddienst nie nachweislich erreicht; sein Ergebnis ließ sich nicht wiederherstellen.'

export interface ReconcileConfig {
  staleMinutes: number
  unknownGraceMinutes: number
  batch: number
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function readReconcileConfig(env: Record<string, string | undefined> = process.env): ReconcileConfig {
  const staleMinutes = positiveInt(env.RUN_RECONCILE_STALE_MINUTES, DEFAULT_STALE_MINUTES)
  const unknownGraceMinutes = Math.max(
    staleMinutes,
    positiveInt(env.RUN_RECONCILE_UNKNOWN_GRACE_MINUTES, DEFAULT_UNKNOWN_GRACE_MINUTES),
  )
  return { staleMinutes, unknownGraceMinutes, batch: RECONCILE_BATCH }
}

export type JobProbe =
  | { kind: 'no-job' }
  | { kind: 'not-found' }
  | { kind: 'unreachable' }
  | { kind: 'found'; outcome: BackendJobOutcome }

export type ReconcileDecision =
  | { kind: 'wait'; why: 'still-running' | 'unreachable' | 'within-grace' }
  | {
      kind: 'close'
      outcome: TaskOutcome
      message: { content: string; metadata: Record<string, unknown> } | null
    }

type RunForDecision = Pick<TaskRun, 'createdAt' | 'startedAt'>

function lostRun(reason: string): ReconcileDecision {
  return { kind: 'close', outcome: { status: 'failure', error: reason }, message: null }
}

export function decideReconciliation(
  run: RunForDecision,
  probe: JobProbe,
  now: Date,
  config: Pick<ReconcileConfig, 'unknownGraceMinutes'>,
): ReconcileDecision {
  if (probe.kind === 'unreachable') return { kind: 'wait', why: 'unreachable' }

  if (probe.kind === 'found') {
    const { outcome } = probe
    if (outcome.status === 'submitted' || outcome.status === 'running') {
      return { kind: 'wait', why: 'still-running' }
    }
    const taskOutcome: TaskOutcome = {
      status: outcome.status,
      error: outcome.error,
      report: outcome.report,
      cards: outcome.cards,
    }
    return { kind: 'close', outcome: taskOutcome, message: outcome.message }
  }

  const since = run.startedAt ?? run.createdAt
  const ageMinutes = (now.getTime() - since.getTime()) / 60_000
  if (ageMinutes < config.unknownGraceMinutes) return { kind: 'wait', why: 'within-grace' }
  return lostRun(probe.kind === 'no-job' ? NEVER_SUBMITTED_REASON : LOST_JOB_REASON)
}

async function probeJob(run: TaskRun): Promise<JobProbe> {
  if (!run.backendJobId) return { kind: 'no-job' }
  try {
    const outcome = await fetchBackendJobOutcome(run.backendJobId, run.organizationId)
    return outcome ? { kind: 'found', outcome } : { kind: 'not-found' }
  } catch (error) {
    console.warn('[runs] reconcile: could not ask the job store about run', run.id, error)
    return { kind: 'unreachable' }
  }
}

export type ReconcileVerdict = 'closed' | 'already-closed' | 'waiting' | 'failed'

async function settleRunMessage(run: TaskRun, decision: Extract<ReconcileDecision, { kind: 'close' }>) {
  if (!decision.message || !run.backendJobId) return
  const current = await readRunMessage(run)
  if (!current || current.content.trim() !== '') return
  await writeRunReport(run.backendJobId, decision.message)
}

async function believeTheBlock(run: TaskRun, probe: JobProbe): Promise<ReconcileDecision | null> {
  if (probe.kind !== 'no-job' && probe.kind !== 'not-found') return null
  const message = await readRunMessage(run)
  if (!message?.ledger || runDisplayStatus(message.ledger) !== 'done') return null
  return { kind: 'close', outcome: { status: 'success', report: message.content.trim() || null }, message: null }
}

export async function reconcileRun(
  run: TaskRun,
  config: Pick<ReconcileConfig, 'unknownGraceMinutes'>,
  now: Date = new Date(),
): Promise<ReconcileVerdict> {
  return (await reconcileRunWithEnding(run, config, now)).verdict
}

export async function reconcileRunWithEnding(
  run: TaskRun,
  config: Pick<ReconcileConfig, 'unknownGraceMinutes'>,
  now: Date = new Date(),
): Promise<{ verdict: ReconcileVerdict; ending?: TaskOutcome['status'] }> {
  const probe = await probeJob(run)
  const decision = (await believeTheBlock(run, probe)) ?? decideReconciliation(run, probe, now, config)
  if (decision.kind === 'wait') return { verdict: 'waiting' }

  await settleRunMessage(run, decision)
  const recorded = await recordRunOutcome(run, decision.outcome, { onlyIfActive: true })
  return recorded.closed ? { verdict: 'closed', ending: decision.outcome.status } : { verdict: 'already-closed' }
}

export interface ReconcileSweepResult {
  checked: number
  closed: number
  alreadyClosed: number
  waiting: number
  healed: number
  failed: number
}

async function releaseHealClaim(run: TaskRun): Promise<void> {
  try {
    await withTenant({ organizationId: run.organizationId }, () => taskRepository.releaseHealClaim(run.id))
  } catch (error) {
    console.error('[runs] reconcile: closed run', run.id, 'could not be handed back to the heal', error)
  }
}

async function healClosedRuns(batch: number, now: Date): Promise<{ healed: number; failed: number }> {
  const claimed = await withPlatformAccess(
    'run reconciler: finding the closed runs of every organization not looked at since they ended',
    () => taskRepository.claimClosedRunsToHeal(batch),
  )
  const counts = { healed: 0, failed: 0 }
  for (let i = 0; i < claimed.length; i += RECONCILE_CONCURRENCY) {
    const slice = claimed.slice(i, i + RECONCILE_CONCURRENCY)
    const results = await Promise.all(
      slice.map(async (run) => {
        try {
          return await withTenant({ organizationId: run.organizationId }, () =>
            settleRunLedger(run, endingOfClosedRun(run), run.finishedAt ?? now),
          )
        } catch (error) {
          console.error('[runs] reconcile: the block of closed run', run.id, 'could not be settled', error)
          await releaseHealClaim(run)
          return 'failed' as const
        }
      }),
    )
    for (const result of results) {
      if (result === 'failed') counts.failed += 1
      else if (result) counts.healed += 1
    }
  }
  return counts
}

export async function reconcileStaleRuns(
  now: Date = new Date(),
  config: ReconcileConfig = readReconcileConfig(),
): Promise<ReconcileSweepResult> {
  const checkedBefore = new Date(now.getTime() - config.staleMinutes * 60_000)
  const claimed = await withPlatformAccess(
    'run reconciler: finding the still-active runs of every organization that nothing has checked recently',
    () => taskRepository.claimRunsToReconcile(checkedBefore, config.batch),
  )

  const result: ReconcileSweepResult = {
    checked: claimed.length,
    closed: 0,
    alreadyClosed: 0,
    waiting: 0,
    healed: 0,
    failed: 0,
  }
  for (let i = 0; i < claimed.length; i += RECONCILE_CONCURRENCY) {
    const slice = claimed.slice(i, i + RECONCILE_CONCURRENCY)
    const verdicts = await Promise.all(
      slice.map(async (run): Promise<ReconcileVerdict> => {
        try {
          return await withTenant({ organizationId: run.organizationId }, () => reconcileRun(run, config, now))
        } catch (error) {
          console.error('[runs] reconcile: run', run.id, 'could not be reconciled', error)
          return 'failed'
        }
      }),
    )
    for (const verdict of verdicts) {
      if (verdict === 'closed') result.closed += 1
      else if (verdict === 'already-closed') result.alreadyClosed += 1
      else if (verdict === 'waiting') result.waiting += 1
      else result.failed += 1
    }
  }

  const healed = await healClosedRuns(HEAL_BATCH, now)
  result.healed = healed.healed
  result.failed += healed.failed
  return result
}
