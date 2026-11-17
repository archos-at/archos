import {
  LEGACY_DEGRADED_REASON,
  type StoredThinkingStep,
} from '@/lib/conversations/message-provenance'
import { stepEventLiveText, type StepEventTranslator } from './turn-event-keys'

export const liveLine = (
  steps: readonly Pick<StoredThinkingStep, 'turnEvent'>[],
  t: StepEventTranslator
): string | null => {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const text = stepEventLiveText(steps[i], t)
    if (text) return text
  }
  return null
}

type StatusRow = Pick<StoredThinkingStep, 'kind' | 'slot' | 'detail'>
type Detail = NonNullable<StoredThinkingStep['detail']>

const lastStatusDetail = (steps: readonly StatusRow[], slots: readonly string[]): Detail | null => {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]
    if (step.kind === 'status' && step.slot && slots.includes(step.slot) && step.detail) {
      return step.detail
    }
  }
  return null
}

const stringsOf = (value: Detail[string] | undefined): string[] =>
  Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : []

const countOf = (value: Detail[string] | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

export interface ResearchTruncation {
  lastTool?: string
}

const BUDGET_SLOTS: readonly string[] = ['budget', 'budget:input']

export const researchTruncation = (steps: readonly StatusRow[]): ResearchTruncation | null => {
  const detail = lastStatusDetail(steps, BUDGET_SLOTS)
  if (detail?.truncated !== true) return null
  const tools = stringsOf(detail.tools)
  return tools.length > 0 ? { lastTool: tools[tools.length - 1] } : {}
}

export type DeepCutoffReason = 'wall_clock' | 'step_limit'
const DEEP_CUTOFF_REASONS: readonly string[] = ['wall_clock', 'step_limit']

export interface DeepResearchCutoff {
  reason: DeepCutoffReason | null
  salvaged: boolean
  sourceCount?: number
  elapsedSeconds?: number
}

export const deepResearchCutoff = (steps: readonly StatusRow[]): DeepResearchCutoff | null => {
  const detail = lastStatusDetail(steps, ['budget:deep'])
  if (detail?.truncated !== true) return null
  const reason = typeof detail.reason === 'string' ? detail.reason.trim() : ''
  return {
    reason: DEEP_CUTOFF_REASONS.includes(reason) ? (reason as DeepCutoffReason) : null,
    salvaged: detail.salvaged === true,
    sourceCount: countOf(detail.source_count),
    elapsedSeconds: countOf(detail.elapsed_seconds),
  }
}

export const ANSWER_DEGRADATIONS = [
  'no_report_file',
  'no_valid_citations',
  'cards_generation_failed',
  'basis_unread',
] as const
export type AnswerDegradation = (typeof ANSWER_DEGRADATIONS)[number]

export const answerDegradations = (steps: readonly StatusRow[]): AnswerDegradation[] => {
  const detail = lastStatusDetail(steps, ['degraded'])
  if (detail?.degraded !== true) return []
  const out: AnswerDegradation[] = []
  for (const token of stringsOf(detail.reasons)) {
    const reason = (LEGACY_DEGRADED_REASON[token] ?? token) as AnswerDegradation
    if (ANSWER_DEGRADATIONS.includes(reason) && !out.includes(reason)) out.push(reason)
  }
  return out
}
