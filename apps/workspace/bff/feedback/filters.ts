import type { AnswerFeedbackReason } from '@/lib/db/schema/answer-feedback'
import {
  canonicalConversationTagKey,
  CONVERSATION_TAG_KEYS,
  isConversationTagKey,
  type ConversationTagKey,
} from '@/lib/conversations/tags'
import { writeQualityScope, type QualityScope } from '@/lib/quality/scope'

export const FEEDBACK_VERDICT_FILTERS = ['up', 'down'] as const
export type FeedbackVerdictFilter = (typeof FEEDBACK_VERDICT_FILTERS)[number]

export const FEEDBACK_REASON_FILTERS = ['inaccurate', 'wrong_source', 'too_slow', 'other'] as const satisfies readonly AnswerFeedbackReason[]
export type FeedbackReasonFilter = (typeof FEEDBACK_REASON_FILTERS)[number]
type MissingReason = Exclude<AnswerFeedbackReason, FeedbackReasonFilter>
const REASONS_EXHAUSTIVE: [MissingReason] extends [never] ? true : never = true
void REASONS_EXHAUSTIVE

export const FEEDBACK_MODE_FILTERS = ['meta', 'shallow', 'deep', 'report'] as const
export type FeedbackModeFilter = (typeof FEEDBACK_MODE_FILTERS)[number]

export const FEEDBACK_CONFIDENCE_FILTERS = ['low', 'medium', 'high'] as const
export type FeedbackConfidenceFilter = (typeof FEEDBACK_CONFIDENCE_FILTERS)[number]

export const MAX_FEEDBACK_QUERY_CHARS = 120

export interface RatingsFilters {
  verdict: FeedbackVerdictFilter | null
  reasons: FeedbackReasonFilter[]
  topics: ConversationTagKey[]
  modes: FeedbackModeFilter[]
  confidences: FeedbackConfidenceFilter[]
  hasComment: boolean
  hasExpectedAnswer: boolean
  query: string | null
}

export interface FeedbackQuery {
  scope: QualityScope
  ratings: RatingsFilters
}

export const NO_RATINGS_FILTERS: RatingsFilters = Object.freeze({
  verdict: null,
  reasons: [],
  topics: [],
  modes: [],
  confidences: [],
  hasComment: false,
  hasExpectedAnswer: false,
  query: null,
}) as RatingsFilters

export const RATINGS_FILTER_PARAMS = {
  verdict: 'verdict',
  reasons: 'reason',
  topics: 'topic',
  modes: 'mode',
  confidences: 'confidence',
  hasComment: 'has_comment',
  hasExpectedAnswer: 'has_expected',
  query: 'q',
} as const satisfies Record<keyof RatingsFilters, string>

export type RatingsFilterKey = keyof RatingsFilters

export function inVocabularyOrder<T extends string>(vocabulary: readonly T[], list: readonly string[]): T[] {
  const wanted = new Set(list)
  return vocabulary.filter((value) => wanted.has(value))
}

export function normalizeRatingsFilters(filters: RatingsFilters): RatingsFilters {
  const query = filters.query?.trim().slice(0, MAX_FEEDBACK_QUERY_CHARS) || null
  return {
    verdict: filters.verdict,
    reasons: filters.verdict === 'up' ? [] : inVocabularyOrder(FEEDBACK_REASON_FILTERS, filters.reasons),
    topics: inVocabularyOrder(CONVERSATION_TAG_KEYS, filters.topics),
    modes: inVocabularyOrder(FEEDBACK_MODE_FILTERS, filters.modes),
    confidences: inVocabularyOrder(FEEDBACK_CONFIDENCE_FILTERS, filters.confidences),
    hasComment: filters.hasComment,
    hasExpectedAnswer: filters.hasExpectedAnswer,
    query,
  }
}

export function readRatingsFilters(params: URLSearchParams): RatingsFilters {
  const p = RATINGS_FILTER_PARAMS
  const verdict = params.get(p.verdict)
  const topics = params.getAll(p.topics).map((value) => canonicalConversationTagKey(value.trim().toLowerCase()))
  return normalizeRatingsFilters({
    verdict: verdict === 'up' || verdict === 'down' ? verdict : null,
    reasons: inVocabularyOrder(FEEDBACK_REASON_FILTERS, params.getAll(p.reasons)),
    topics: topics.filter(isConversationTagKey),
    modes: inVocabularyOrder(FEEDBACK_MODE_FILTERS, params.getAll(p.modes)),
    confidences: inVocabularyOrder(FEEDBACK_CONFIDENCE_FILTERS, params.getAll(p.confidences)),
    hasComment: params.get(p.hasComment) === '1',
    hasExpectedAnswer: params.get(p.hasExpectedAnswer) === '1',
    query: params.get(p.query),
  })
}

export function writeRatingsFilters(params: URLSearchParams, filters: RatingsFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  const p = RATINGS_FILTER_PARAMS
  for (const key of Object.values(p)) next.delete(key)
  const canonical = normalizeRatingsFilters(filters)
  if (canonical.verdict) next.set(p.verdict, canonical.verdict)
  for (const value of canonical.reasons) next.append(p.reasons, value)
  for (const value of canonical.topics) next.append(p.topics, value)
  for (const value of canonical.modes) next.append(p.modes, value)
  for (const value of canonical.confidences) next.append(p.confidences, value)
  if (canonical.hasComment) next.set(p.hasComment, '1')
  if (canonical.hasExpectedAnswer) next.set(p.hasExpectedAnswer, '1')
  if (canonical.query) next.set(p.query, canonical.query)
  return next
}

export function ratingsFiltered(filters: RatingsFilters): boolean {
  return (
    filters.verdict !== null ||
    filters.reasons.length > 0 ||
    filters.topics.length > 0 ||
    filters.modes.length > 0 ||
    filters.confidences.length > 0 ||
    filters.hasComment ||
    filters.hasExpectedAnswer ||
    Boolean(filters.query)
  )
}

export function activeRatingsFilterKeys(filters: RatingsFilters): RatingsFilterKey[] {
  const keys: RatingsFilterKey[] = []
  if (filters.verdict) keys.push('verdict')
  if (filters.reasons.length) keys.push('reasons')
  if (filters.topics.length) keys.push('topics')
  if (filters.modes.length) keys.push('modes')
  if (filters.confidences.length) keys.push('confidences')
  if (filters.hasComment) keys.push('hasComment')
  if (filters.hasExpectedAnswer) keys.push('hasExpectedAnswer')
  if (filters.query) keys.push('query')
  return keys
}

export function feedbackQueryString(query: FeedbackQuery): string {
  return writeRatingsFilters(writeQualityScope(new URLSearchParams(), query.scope), query.ratings).toString()
}

export function toggleValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}
