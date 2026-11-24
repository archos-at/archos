import { check, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const PERSONAL_SOURCES = ['personal_shelf', 'personal_memory'] as const
export type PersonalSource = (typeof PERSONAL_SOURCES)[number]

export const conversationPersonalSources = pgTable(
  'conversation_personal_sources',
  {
    organizationId: text('organization_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    source: text('source').$type<PersonalSource>().notNull(),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'conversation_personal_sources_pk',
      columns: [table.organizationId, table.conversationId, table.source],
    }),
    known: check('conversation_personal_sources_known', sql`${table.source} IN ('personal_shelf', 'personal_memory')`),
    order: check('conversation_personal_sources_order', sql`${table.lastAt} >= ${table.firstAt}`),
  })
)
