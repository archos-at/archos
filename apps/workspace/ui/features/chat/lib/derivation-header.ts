/**
 * The Herleitung header's state, as a pure mapping: which phase the turn is in,
 * and the one warning a settled header carries. `ChatThinking` draws it.
 *
 * A settled turn reads what the answer says about itself, not only how the
 * turn looked things up: the worst thing its answer check (ADR-0139,
 * `confidenceCheck` on the message) found, and whether it asked the reader back.
 *
 * | The settled answer, first match wins                         | Status      | Glyph          | Pill (at most one)            |
 * |--------------------------------------------------------------|-------------|----------------|-------------------------------|
 * | a statement `contradicted`, or any finding at level `low`    | `flagged`   | warning        | „1 Aussage widerspricht der Quelle“ |
 * | cites nothing and its last line of prose is a question       | `askedBack` | question       | its finding, if any           |
 * | anything else; „mostly backed“ (medium, only `unbacked`) too | `done`      | green check    | „2 Aussagen ohne Beleg“, else „1 Abruf fehlgeschlagen“, else „1 Punkt offen“ |
 *
 * A finding outranks a failed call or an open point in the pill: those say how
 * the turn looked things up, a finding says the answer itself is not backed.
 * The glyph turns only for a finding that sinks the answer; a medium answer
 * with a side statement unbacked keeps its check and lets the pill say so.
 *
 * „Asked back" is read off the prose, so it only counts for an answer that
 * cites nothing: the agent closes a cited answer under a stated assumption
 * with an invitation to correct it („Liegt das Projekt in einem anderen
 * Bundesland?"), and that answer is complete. An uncited answer under an
 * assumption still reads as asked back; a field the agent sets on the answer
 * meta would end the guess.
 */

import type { ConfidenceCheck, ConfidenceFinding } from '@/lib/conversations/confidence-check'

export type HeaderStatus =
  | 'live'
  | 'waiting'
  | 'recovering'
  | 'interrupted'
  | 'stopped'
  | 'failed'
  | 'handedOff'
  | 'refused'
  | 'askedBack'
  | 'flagged'
  | 'done'

/** How a turn ended that has no answer of its own to be „Fertig" with (see `ChatThinkingProps.endedAs`). */
export type ThinkingEnding = 'failed' | 'handed_off' | 'refused'

export interface HeaderStatusInput {
  isThinking: boolean
  isWaiting: boolean
  isInterrupted: boolean
  isRecoveryPending: boolean
  isStopped: boolean
  endedAs?: ThinkingEnding
  /** The settled answer ends by asking the reader something (`answerAsksBack`). */
  asksBack: boolean
  /** The answer check's worst finding, if it found one. */
  worst: WorstFinding | null
}

const ENDINGS: Record<ThinkingEnding, HeaderStatus> = {
  failed: 'failed',
  handed_off: 'handedOff',
  refused: 'refused',
}

/** The header's phase. The answer's own verdict only counts once the turn ended with one. */
export function headerStatus(input: HeaderStatusInput): HeaderStatus {
  if (input.isThinking) return 'live'
  if (input.isWaiting) return 'waiting'
  if (input.isInterrupted) return input.isRecoveryPending ? 'recovering' : 'interrupted'
  if (input.isStopped) return 'stopped'
  if (input.endedAs) return ENDINGS[input.endedAs]
  if (input.worst?.sinks) return 'flagged'
  return input.asksBack ? 'askedBack' : 'done'
}

/** A settled turn with an answer: the states that carry a warning pill. */
export const isSettledAnswer = (status: HeaderStatus): boolean =>
  status === 'done' || status === 'flagged' || status === 'askedBack'

export type FindingProblem = ConfidenceFinding['problem']

/** The one finding the header names: the worst problem, with how many statements have it. */
export interface WorstFinding {
  problem: FindingProblem
  count: number
  /** It sinks the answer: a contradiction, or a check that rated the answer low. */
  sinks: boolean
}

/** Worst first: a source that says otherwise beats a source that says nothing. */
const SEVERITY: readonly FindingProblem[] = ['contradicted', 'unbacked']

/** The worst problem the check found, or null for a clean, unavailable or absent check. */
export function worstFinding(check: ConfidenceCheck | undefined): WorstFinding | null {
  if (check?.status !== 'judged') return null
  for (const problem of SEVERITY) {
    const count = check.findings.filter((finding) => finding.problem === problem).length
    if (count > 0) return { problem, count, sinks: problem === 'contradicted' || check.level === 'low' }
  }
  return null
}

/** The pill's kind is its dictionary key under `thinking.derivationWarning`. */
export interface HeaderWarning {
  kind: FindingProblem | 'failed' | 'open'
  count: number
}

/** The one warning a settled header carries: a finding, else a failed call, else an open point. */
export function headerWarning(
  status: HeaderStatus,
  worst: WorstFinding | null,
  calls: { failed: number; open: number }
): HeaderWarning | null {
  if (!isSettledAnswer(status)) return null
  if (worst) return { kind: worst.problem, count: worst.count }
  if (calls.failed > 0) return { kind: 'failed', count: calls.failed }
  if (calls.open > 0) return { kind: 'open', count: calls.open }
  return null
}

/** Closing marks a question may sit inside: emphasis, quotes, brackets. */
const TRAILING_MARKS = /[*_"'“”„»«)\]\s]+$/

/** A citation marker in the prose: `[1]`. A sources list carries them too. */
const MARKER = /\[\d+\]/

/**
 * Whether the answer asks the reader back instead of answering: it cites
 * nothing (no citation, no marker anywhere in its text) and its last line is a
 * question. „In welchem Bundesland liegt das Bauvorhaben?“ under an uncited
 * answer is; the same line under „1,00 m [1].“ is an invitation to correct an
 * assumption, and is not.
 */
export function answerAsksBack(text: string | undefined, cited: number): boolean {
  if (!text || cited > 0 || MARKER.test(text)) return false
  const last = text.trim().split('\n').at(-1) ?? ''
  return last.replace(TRAILING_MARKS, '').endsWith('?')
}
