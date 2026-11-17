import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const platformModelDefaults = pgTable('platform_model_defaults', {
  agentGroup: text('agent_group').primaryKey(),
  model: text('model').notNull(),
  modelSnapshot: jsonb('model_snapshot'),
  note: text('note'),
  updatedBy: text('updated_by').notNull(),
  updatedByEmail: text('updated_by_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PlatformModelDefault = typeof platformModelDefaults.$inferSelect
export type NewPlatformModelDefault = typeof platformModelDefaults.$inferInsert
