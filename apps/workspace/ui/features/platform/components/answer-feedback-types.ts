import type { ConversationTagKey } from '@/lib/conversations/tags'
import { FEEDBACK_REASON_FILTERS, type FeedbackReasonFilter } from '@/lib/feedback/filters'

export const FEEDBACK_REASONS = FEEDBACK_REASON_FILTERS
export type FeedbackReason = FeedbackReasonFilter

export const MIN_RATE_VOTES = 5

export type FeedbackVerdict = 'down' | 'up'

export interface FeedbackHealthTurn {
  id: string
  organizationId: string
  organizationName?: string | null
  projectId: string | null
  conversationId: string | null
  messageId: string
  verdict: FeedbackVerdict
  reason: FeedbackReason | null
  createdAt: string
  answer: string | null
  question: string | null
  conversationTitle: string | null
  topics: ConversationTagKey[]
  comment?: string | null
  expectedAnswer?: string | null
  langfuseTraceUrl?: string | null
}

export interface FeedbackOrgRow {
  organizationId: string
  organizationName?: string | null
  up: number
  down: number
  voters: number
}

export interface FeedbackHealthResponse {
  from?: string
  to?: string
  windowDays: number
  answers: number
  ratedAnswers?: number
  coverage?: number | null
  totals: { up: number; down: number; voters: number; downVoters: number }
  reasons: { reason: FeedbackReason | null; count: number }[]
  daily: { day: string; up: number; down: number }[]
  organizations: FeedbackOrgRow[]
  topics: { topic: ConversationTagKey; up: number; down: number; voters: number }[]
  turns: FeedbackHealthTurn[]
  langfuse?: { projectUrl: string } | null
}

export const formatCount = (value: number, locale: string, decimals = 0): string =>
  value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

export const orgLabel = (row: {
  organizationId: string
  organizationName?: string | null
}): string => row.organizationName?.trim() || row.organizationId

export function excerpt(value: string | null | undefined, max = 180): string | null {
  if (!value) return null
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
