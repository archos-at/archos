import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { projects } from './projects'

export const ANSWER_FEEDBACK_VERDICTS = ['up', 'down'] as const
export type AnswerFeedbackVerdict = (typeof ANSWER_FEEDBACK_VERDICTS)[number]

export const ANSWER_FEEDBACK_REASONS = ['inaccurate', 'too_slow', 'wrong_source', 'other'] as const
export type AnswerFeedbackReason = (typeof ANSWER_FEEDBACK_REASONS)[number]

export const answerFeedback = pgTable(
  'answer_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id'),
    messageId: text('message_id').notNull(),
    userId: text('user_id').notNull(),
    verdict: text('verdict').$type<AnswerFeedbackVerdict>().notNull(),
    reason: text('reason').$type<AnswerFeedbackReason>(),
    comment: text('comment'),
    expectedAnswer: text('expected_answer'),
    lessonsHoldout: boolean('lessons_holdout'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userMessageUidx: uniqueIndex('answer_feedback_user_message_uidx').on(
      table.userId,
      table.messageId
    ),
    orgConversationIdx: index('answer_feedback_org_conversation_idx').on(
      table.organizationId,
      table.conversationId
    ),
    orgProjectIdx: index('answer_feedback_org_project_idx').on(
      table.organizationId,
      table.projectId
    ),
  })
)

export type AnswerFeedback = typeof answerFeedback.$inferSelect
export type NewAnswerFeedback = typeof answerFeedback.$inferInsert
