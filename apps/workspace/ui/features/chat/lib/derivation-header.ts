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

export type ThinkingEnding = 'failed' | 'handed_off' | 'refused'

export interface HeaderStatusInput {
  isThinking: boolean
  isWaiting: boolean
  isInterrupted: boolean
  isRecoveryPending: boolean
  isStopped: boolean
  endedAs?: ThinkingEnding
  asksBack: boolean
  worst: WorstFinding | null
}

const ENDINGS: Record<ThinkingEnding, HeaderStatus> = {
  failed: 'failed',
  handed_off: 'handedOff',
  refused: 'refused',
}

export function headerStatus(input: HeaderStatusInput): HeaderStatus {
  if (input.isThinking) return 'live'
  if (input.isWaiting) return 'waiting'
  if (input.isInterrupted) return input.isRecoveryPending ? 'recovering' : 'interrupted'
  if (input.isStopped) return 'stopped'
  if (input.endedAs) return ENDINGS[input.endedAs]
  if (input.worst?.sinks) return 'flagged'
  return input.asksBack ? 'askedBack' : 'done'
}

export const isSettledAnswer = (status: HeaderStatus): boolean =>
  status === 'done' || status === 'flagged' || status === 'askedBack'

export type FindingProblem = ConfidenceFinding['problem']

export interface WorstFinding {
  problem: FindingProblem
  count: number
  sinks: boolean
}

const SEVERITY: readonly FindingProblem[] = ['contradicted', 'unbacked']

export function worstFinding(check: ConfidenceCheck | undefined): WorstFinding | null {
  if (check?.status !== 'judged') return null
  for (const problem of SEVERITY) {
    const count = check.findings.filter((finding) => finding.problem === problem).length
    if (count > 0) return { problem, count, sinks: problem === 'contradicted' || check.level === 'low' }
  }
  return null
}

export interface HeaderWarning {
  kind: FindingProblem | 'failed' | 'open'
  count: number
}

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

const TRAILING_MARKS = /[*_"'“”„»«)\]\s]+$/

const MARKER = /\[\d+\]/

export function answerAsksBack(text: string | undefined, cited: number): boolean {
  if (!text || cited > 0 || MARKER.test(text)) return false
  const last = text.trim().split('\n').at(-1) ?? ''
  return last.replace(TRAILING_MARKS, '').endsWith('?')
}
