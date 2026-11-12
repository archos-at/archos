/**
 * The Herleitung header's state, as a pure mapping: which phase the turn is in,
 * and the one warning a settled header carries. `ChatThinking` draws it.
 *
 * A settled turn reads what the answer says about itself, not only how the
 * turn looked things up: whether it asked the reader back, and the worst thing
 * its answer check (ADR-0139, `confidenceCheck` on the message) found.
 *
 * | The settled answer                            | Status      | Glyph            | Pill (at most one, worst first)        |
 * |-----------------------------------------------|-------------|------------------|----------------------------------------|
 * | ends by asking the reader (last line is a ?)  | `askedBack` | question, brand  | its worst finding, else a call's       |
 * | the check found a statement `contradicted`    | `flagged`   | warning          | „1 Aussage widerspricht der Quelle“    |
 * | the check found a statement `unbacked`        | `flagged`   | warning          | „2 Aussagen ohne Beleg“                |
 * | none of that (or the check did not run)       | `done`      | green check      | „1 Abruf fehlgeschlagen“, „1 Punkt offen“ |
 *
 * A finding outranks a failed call or an open point: those say how the turn
 * looked things up, a finding says the answer the reader acts on is not backed.
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
  /** The settled answer ends by asking the reader something. */
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
  if (input.asksBack) return 'askedBack'
  return input.worst ? 'flagged' : 'done'
}

/** A settled turn with an answer: the states that carry a warning pill. */
export const isSettledAnswer = (status: HeaderStatus): boolean =>
  status === 'done' || status === 'flagged' || status === 'askedBack'

export type FindingProblem = ConfidenceFinding['problem']

/** The one finding the header names: the worst problem, with how many statements have it. */
export interface WorstFinding {
  problem: FindingProblem
  count: number
}

/** Worst first: a source that says otherwise beats a source that says nothing. */
const SEVERITY: readonly FindingProblem[] = ['contradicted', 'unbacked']

/** The worst problem the check found, or null for a clean, unavailable or absent check. */
export function worstFinding(check: ConfidenceCheck | undefined): WorstFinding | null {
  if (check?.status !== 'judged') return null
  for (const problem of SEVERITY) {
    const count = check.findings.filter((finding) => finding.problem === problem).length
    if (count > 0) return { problem, count }
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

/** A sources list's lines (`- [1] …`) and its heading, which close an answer after its prose. */
const SOURCE_LINE = /^[-*]\s*\[\d+\]/
const HEADING = /^#{1,6}\s/
/** Closing marks a question may sit inside: emphasis, quotes, brackets. */
const TRAILING_MARKS = /[*_"'“”„»«)\]\s]+$/

/**
 * Whether the answer ends by asking the reader something: its last line of
 * prose, after any sources list, is a question. „In welchem Bundesland liegt
 * das Bauvorhaben?“ is; a question quoted mid-answer is not.
 */
export function answerAsksBack(text: string | undefined): boolean {
  if (!text) return false
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  while (lines.length > 0 && SOURCE_LINE.test(lines[lines.length - 1])) lines.pop()
  while (lines.length > 0 && HEADING.test(lines[lines.length - 1])) lines.pop()
  const last = lines.at(-1)
  return last !== undefined && last.replace(TRAILING_MARKS, '').endsWith('?')
}
