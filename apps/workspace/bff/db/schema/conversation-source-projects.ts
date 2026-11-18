import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const conversationSourceProjects = pgTable(
  'conversation_source_projects',
  {
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    projectId: uuid('project_id').notNull(),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'conversation_source_projects_pk',
      columns: [table.organizationId, table.conversationId, table.projectId],
    }),
    order: check('conversation_source_projects_order', sql`${table.lastAt} >= ${table.firstAt}`),
  })
)

export type ConversationSourceProject = typeof conversationSourceProjects.$inferSelect
