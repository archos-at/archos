import { boolean, jsonb, pgTable, text } from 'drizzle-orm/pg-core'

export const userPreferences = pgTable('user_preferences', {
  workosUserId: text('workos_user_id').primaryKey(),
  prefs: jsonb('prefs').notNull().default({}),
  /**
   * The newest weekly release-notes summary the person has seen (`2026-W44`), or null
   * (ADR-0156, amendment). A CHECK holds it to an ISO week id (0194), which sorts as text.
   */
  lastSeenReleaseWeek: text('last_seen_release_week'),
  /** Whether the person wants that notice at all; "Nicht mehr anzeigen" turns it off (0194). */
  releaseSummaryNotice: boolean('release_summary_notice').notNull().default(true),
})

export type UserPreferences = typeof userPreferences.$inferSelect
export type NewUserPreferences = typeof userPreferences.$inferInsert
