import { sql } from 'drizzle-orm'
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const PRODUCT_FEEDBACK_KINDS = ['bug', 'idea', 'praise', 'question'] as const
export type ProductFeedbackKind = (typeof PRODUCT_FEEDBACK_KINDS)[number]

export const PRODUCT_FEEDBACK_MESSAGE_MAX = 5000
export const PRODUCT_FEEDBACK_PAGE_MAX = 500

export interface ProductFeedbackContext {
  userAgent?: string
  viewport?: string
  locale?: string
  timeZone?: string
  appVersion?: string
}

export const productFeedback = pgTable(
  'product_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name'),
    userEmail: text('user_email'),
    kind: text('kind').$type<ProductFeedbackKind>().notNull(),
    message: text('message').notNull(),
    pagePath: text('page_path'),
    context: jsonb('context').$type<ProductFeedbackContext>().notNull().default({}),
    allowContact: boolean('allow_contact').notNull().default(true),
    posthogTicketId: text('posthog_ticket_id'),
    posthogWidgetSessionId: text('posthog_widget_session_id'),
    reporterSeenAt: timestamp('reporter_seen_at', { withTimezone: true }),
    reporterNotifiedAt: timestamp('reporter_notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdIdx: index('product_feedback_created_idx').on(table.createdAt, table.id),
    ticketIdx: index('product_feedback_posthog_ticket_idx')
      .on(table.posthogTicketId)
      .where(sql`${table.posthogTicketId} IS NOT NULL`),
    orgUserCreatedIdx: index('product_feedback_org_user_created_idx').on(
      table.organizationId,
      table.userId,
      table.createdAt
    ),
  })
)

export type ProductFeedback = typeof productFeedback.$inferSelect
export type NewProductFeedback = typeof productFeedback.$inferInsert
