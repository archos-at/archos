import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const platformReasoningEfforts = pgTable('platform_reasoning_efforts', {
  agentGroup: text('agent_group').primaryKey(),
  effort: text('effort').notNull(),
  note: text('note'),
  updatedBy: text('updated_by').notNull(),
  updatedByEmail: text('updated_by_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PlatformReasoningEffort = typeof platformReasoningEfforts.$inferSelect
export type NewPlatformReasoningEffort = typeof platformReasoningEfforts.$inferInsert
