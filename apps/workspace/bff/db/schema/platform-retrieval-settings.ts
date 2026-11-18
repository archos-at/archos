import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const platformRetrievalSettings = pgTable('platform_retrieval_settings', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
  note: text('note'),
  updatedBy: text('updated_by').notNull(),
  updatedByEmail: text('updated_by_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PlatformRetrievalSetting = typeof platformRetrievalSettings.$inferSelect
export type NewPlatformRetrievalSetting = typeof platformRetrievalSettings.$inferInsert
