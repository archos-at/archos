import {
  RUN_PHASES,
  RUN_STATUSES,
  type RunLedger,
  type RunPhase,
  type RunStatus,
  type RunStep,
  type RunLedgerDoc,
} from './run-ledger-types'

export type PhaseState = 'done' | 'active' | 'pending'

export interface RunTallies {
  rounds: number
  docs: number
  findings?: number
}

const STATUS_SET: ReadonlySet<string> = new Set<string>(RUN_STATUSES)

export function runDisplayStatus(ledger: RunLedger): RunStatus {
  if (STATUS_SET.has(ledger.status)) return ledger.status
  if (ledger.error) return 'failed'
  if (ledger.result) return 'done'
  return ledger.phases.length > 0 ? 'running' : 'created'
}

export function isLiveStatus(status: RunStatus): boolean {
  return status === 'created' || status === 'running' || status === 'waiting'
}

export function activePhase(ledger: RunLedger): RunPhase | null {
  for (let i = ledger.phases.length - 1; i >= 0; i--) {
    const entry = ledger.phases[i]
    if (entry && !entry.endedAt) return entry.phase
  }
  return null
}

export function phaseState(ledger: RunLedger, phase: RunPhase): PhaseState {
  const entry = ledger.phases.find((candidate) => candidate.phase === phase)
  if (!entry) return 'pending'
  return entry.endedAt ? 'done' : 'active'
}

export function stepsInPhase(ledger: RunLedger, phase: RunPhase): RunStep[] {
  return ledger.steps.filter((step) => step.phase === phase)
}

export interface BasisReceiptRow {
  doc: RunLedgerDoc
  read: boolean
  loci: string[]
}

export function basisReceipt(ledger: RunLedger): BasisReceiptRow[] {
  const named = ledger.basis ?? []
  if (named.length === 0) return []
  const reached = new Map<string, string[]>()
  for (const step of ledger.steps) {
    for (const doc of step.docs) {
      const key = doc.name.toLocaleLowerCase()
      const loci = reached.get(key) ?? []
      for (const locus of doc.loci) if (!loci.includes(locus)) loci.push(locus)
      reached.set(key, loci)
    }
  }
  return named.map((doc) => {
    const loci = reached.get(doc.name.toLocaleLowerCase())
    return { doc, read: loci !== undefined, loci: loci ?? [] }
  })
}

export function runTallies(ledger: RunLedger): RunTallies {
  const names = new Set<string>()
  let findings = 0
  for (const step of ledger.steps) {
    for (const doc of step.docs) names.add(doc.name)
    findings += step.findings?.length ?? 0
  }
  return { rounds: stepsInPhase(ledger, 'researching').length, docs: names.size, findings }
}

export function completedBefore(ledger: RunLedger): RunPhase[] {
  const done = new Set<RunPhase>(
    ledger.error?.completedBefore ??
      ledger.phases.filter((entry) => entry.endedAt).map((entry) => entry.phase)
  )
  return RUN_PHASES.filter((phase) => done.has(phase))
}

function ms(instant: string | undefined): number | null {
  if (!instant) return null
  const value = Date.parse(instant)
  return Number.isFinite(value) ? value : null
}

export function elapsedMs(ledger: RunLedger, now: number): number {
  const started = ms(ledger.startedAt)
  if (started === null) return 0
  const waiting = runDisplayStatus(ledger) === 'waiting' ? ms(ledger.updatedAt) : null
  const ended = ms(ledger.finishedAt) ?? waiting ?? now
  return Math.max(0, ended - started)
}

export function phaseDurationMs(ledger: RunLedger, phase: RunPhase, now: number): number | null {
  const entry = ledger.phases.find((candidate) => candidate.phase === phase)
  if (!entry) return null
  const started = ms(entry.startedAt)
  if (started === null) return null
  const ended = ms(entry.endedAt) ?? ms(ledger.finishedAt) ?? now
  return Math.max(0, ended - started)
}
