import type { Translator } from '@/i18n'
import type { RunLedger, RunPhase, RunStatus } from '@/lib/runs/run-ledger-types'
import { activePhase, completedBefore, type RunTallies } from '@/lib/runs/run-vocabulary'

function talliesLabel(t: Translator, tallies: RunTallies): string {
  return [
    tallies.rounds > 0 ? t('tallies.rounds', { count: tallies.rounds }) : null,
    tallies.docs > 0 ? t('tallies.docs', { count: tallies.docs }) : null,
    (tallies.findings ?? 0) > 0 ? t('tallies.findings', { count: tallies.findings ?? 0 }) : null,
  ]
    .filter((clause): clause is string => clause !== null)
    .join(' · ')
}

function clauses(...parts: (string | null)[]): string {
  return parts.filter((part): part is string => !!part).join(' · ')
}

export function statusLine(
  t: Translator,
  ledger: RunLedger,
  status: RunStatus,
  tallies: RunTallies,
  filesToProject: boolean
): string {
  switch (status) {
    case 'created':
      return clauses(t('status.created'), filesToProject ? t('line.filing') : null)
    case 'running': {
      const phase = activePhase(ledger)
      return clauses(
        phase ? t(`phase.${phase}`) : t('status.running'),
        talliesLabel(t, tallies) || null
      )
    }
    case 'waiting':
      return clauses(t('status.waiting'), t('line.waiting'))
    case 'done':
      return clauses(
        t('status.done'),
        ledger.result?.fileId ? t('line.doneFiled') : t('line.doneInline')
      )
    case 'failed':
      return t('line.failed', { reason: ledger.error?.reason ?? '' })
    case 'cancelled':
      return clauses(t('status.cancelled'), t('line.cancelled'))
    case 'interrupted':
      return clauses(t('status.interrupted'), t('line.interrupted'))
  }
}

export function completedBeforeLabel(
  t: Translator,
  ledger: RunLedger,
  tallies: RunTallies
): string | null {
  const phases = completedBefore(ledger)
  if (phases.length === 0) return null
  const named = phases.map((phase) => {
    const label = t(`phase.${phase}`)
    if (phase !== 'researching' || (tallies.rounds === 0 && tallies.docs === 0)) return label
    return t('completedBeforeTallies', {
      phase: label,
      rounds: t('tallies.rounds', { count: tallies.rounds }),
      docs: t('tallies.docs', { count: tallies.docs }),
    })
  })
  return t('completedBefore', { phases: named.join(', ') })
}

export function doneLine(t: Translator, phase: RunPhase, tallies: RunTallies): string | null {
  switch (phase) {
    case 'planning':
      return t('phaseLine.planning')
    case 'researching':
      return talliesLabel(t, tallies) || null
    case 'checking':
      return t('phaseLine.checking')
    case 'writing':
      return t('phaseLine.writing')
    case 'filed':
      return null
  }
}

export function liveLine(t: Translator, phase: RunPhase): string | null {
  if (phase === 'checking') return t('phaseLine.checkingLive')
  if (phase === 'writing') return t('phaseLine.writingLive')
  return null
}
