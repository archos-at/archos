import { boolean, jsonb, pgTable, text } from 'drizzle-orm/pg-core'

export const userPreferences = pgTable('user_preferences', {
  workosUserId: text('workos_user_id').primaryKey(),
  prefs: jsonb('prefs').notNull().default({}),
  lastSeenReleaseWeek: text('last_seen_release_week'),
  releaseSummaryNotice: boolean('release_summary_notice').notNull().default(true),
})

export type UserPreferences = typeof userPreferences.$inferSelect
export type NewUserPreferences = typeof userPreferences.$inferInsert
