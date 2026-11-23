import { sql } from 'drizzle-orm'
import { foreignKey, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { conversations } from './conversations'

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: text('conversation_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .default(
        sql.raw(
          `nullif(current_setting('app.organization_id', true), '')`
        )
      ),
    role: text('role').notNull(),
    authorUserId: text('author_user_id'),
    content: text('content').notNull(),
    runId: text('run_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conversationCreatedIdx: index('messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt
    ),
    conversationTenantFk: foreignKey({
      name: 'messages_conversation_id_organization_id_fkey',
      columns: [table.conversationId, table.organizationId],
      foreignColumns: [conversations.id, conversations.organizationId],
    }).onDelete('cascade'),
  })
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
