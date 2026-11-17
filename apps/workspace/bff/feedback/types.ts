import { z } from 'zod'
import { ANSWER_FEEDBACK_REASONS, ANSWER_FEEDBACK_VERDICTS } from '@/lib/db/schema/answer-feedback'

export const MAX_FEEDBACK_ID_LENGTH = 128
export const MAX_FEEDBACK_COMMENT_LENGTH = 2000

const messageIdSchema = z.string().trim().min(1).max(MAX_FEEDBACK_ID_LENGTH)
const conversationIdSchema = z.string().trim().min(1).max(MAX_FEEDBACK_ID_LENGTH)

export const upsertAnswerFeedbackSchema = z.object({
  messageId: messageIdSchema,
  verdict: z.enum(ANSWER_FEEDBACK_VERDICTS),
  reason: z.enum(ANSWER_FEEDBACK_REASONS).nullish(),
  comment: z.string().trim().max(MAX_FEEDBACK_COMMENT_LENGTH).nullish(),
  expectedAnswer: z.string().trim().max(MAX_FEEDBACK_COMMENT_LENGTH).nullish(),
  conversationId: conversationIdSchema.nullish(),
  projectId: z.guid().nullish(),
})

export type UpsertAnswerFeedbackInput = z.infer<typeof upsertAnswerFeedbackSchema>

export const retractAnswerFeedbackQuerySchema = z.object({
  messageId: messageIdSchema,
})

export const conversationFeedbackQuerySchema = z.object({
  conversationId: conversationIdSchema,
})

export interface AnswerFeedbackView {
  messageId: string
  verdict: (typeof ANSWER_FEEDBACK_VERDICTS)[number]
  reason: (typeof ANSWER_FEEDBACK_REASONS)[number] | null
  comment: string | null
  expectedAnswer: string | null
  traceId?: string | null
}

export const EXPORT_TRUNCATED_HEADER = 'X-Export-Truncated'

export const EXPORT_IGNORED_FILTERS_HEADER = 'X-Export-Ignored-Filters'
