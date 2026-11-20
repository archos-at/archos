import type { ChatMessage } from '../types'
import type { TurnView } from '@/lib/turns/turn-fold'

export type AnswerOutcome = 'ok' | 'handed_off' | 'refused' | 'aborted' | 'error'

export interface AnswerCompletion {
  message_id: string | undefined
  outcome: AnswerOutcome
  duration_ms: number | undefined
  citation_count: number
  source_kinds: string
  office_norm_citations: number
  effort: string | undefined
  has_run: boolean
}

const outcomeOf = (view: TurnView): AnswerOutcome => {
  if (view.phase === 'failed') return 'error'
  switch (view.outcome) {
    case 'cancelled':
      return 'aborted'
    case 'refused':
      return 'refused'
    case 'handed_off':
      return 'handed_off'
    default:
      return 'ok'
  }
}

const sourceKindsOf = (answer: ChatMessage | undefined): string => {
  const kinds = new Set<string>()
  for (const citation of answer?.citations ?? []) if (citation.kind) kinds.add(citation.kind)
  return [...kinds].sort().join(',')
}

const officeNormCitationsOf = (answer: ChatMessage | undefined): number =>
  (answer?.citations ?? []).filter((citation) => citation.shelf === 'office_shelf' && citation.line?.edition_id).length

export const answerCompletionOf = (
  view: TurnView,
  previous: TurnView | undefined,
  answer: ChatMessage | undefined,
  durationMs: number | undefined
): AnswerCompletion | null => {
  if (previous?.phase !== 'running' || view.phase === 'running') return null
  return {
    message_id: view.messageId,
    outcome: outcomeOf(view),
    duration_ms: durationMs,
    citation_count: answer?.citations?.length ?? view.sources.length,
    source_kinds: sourceKindsOf(answer),
    office_norm_citations: officeNormCitationsOf(answer),
    effort: answer?.reasoningEffort ?? view.effort,
    has_run: Boolean(view.result?.run),
  }
}
