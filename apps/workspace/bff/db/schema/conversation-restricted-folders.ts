import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const conversationRestrictedFolders = pgTable(
  'conversation_restricted_folders',
  {
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    folderId: uuid('folder_id').notNull(),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'conversation_restricted_folders_pk',
      columns: [table.organizationId, table.conversationId, table.folderId],
    }),
    order: check('conversation_restricted_folders_order', sql`${table.lastAt} >= ${table.firstAt}`),
  })
)

export type ConversationRestrictedFolder = typeof conversationRestrictedFolders.$inferSelect
