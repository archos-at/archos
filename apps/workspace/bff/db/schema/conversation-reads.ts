import { sql } from 'drizzle-orm'
import { foreignKey, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { LEGACY_ORGANIZATION_SETTING } from '../legacy-tenant-settings'
import { conversations } from './conversations'

export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: text('conversation_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .default(
        sql.raw(
          `coalesce(nullif(current_setting('app.organization_id', true), ''), nullif(current_setting('${LEGACY_ORGANIZATION_SETTING}', true), ''))`
        )
      ),
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
