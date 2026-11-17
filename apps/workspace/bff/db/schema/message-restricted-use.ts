import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const messageRestrictedUse = pgTable(
  'message_restricted_use',
  {
    organizationId: text('organization_id').notNull(),
    messageId: text('message_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ name: 'message_restricted_use_pk', columns: [table.organizationId, table.messageId] }),
    conversationIdx: index('message_restricted_use_conversation_idx').on(table.organizationId, table.conversationId),
  })
)

export type MessageRestrictedUse = typeof messageRestrictedUse.$inferSelect
