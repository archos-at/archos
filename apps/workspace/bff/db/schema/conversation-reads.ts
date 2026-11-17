import { sql } from 'drizzle-orm'
import { foreignKey, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { conversations } from './conversations'

export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: text('conversation_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .default(sql`nullif(current_setting('grid.organization_id', true), '')`),
    userId: text('user_id').notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadMessageId: text('last_read_message_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'conversation_reads_pk',
      columns: [table.conversationId, table.userId],
    }),
    conversationTenantFk: foreignKey({
      name: 'conversation_reads_conversation_id_organization_id_fkey',
      columns: [table.conversationId, table.organizationId],
      foreignColumns: [conversations.id, conversations.organizationId],
    }).onDelete('cascade'),
  })
)

export type ConversationRead = typeof conversationReads.$inferSelect
export type NewConversationRead = typeof conversationReads.$inferInsert
