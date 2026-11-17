import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const ANALYTICS_EXPORT_STREAMS = ['posthog_usage_hourly', 'posthog_budget_snapshot', 'posthog_usage_by_outcome'] as const
export type AnalyticsExportStream = (typeof ANALYTICS_EXPORT_STREAMS)[number]

export const analyticsExportCursors = pgTable('analytics_export_cursors', {
  stream: text('stream').$type<AnalyticsExportStream>().primaryKey(),
  exportedThrough: timestamp('exported_through', { withTimezone: true }).notNull(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AnalyticsExportCursor = typeof analyticsExportCursors.$inferSelect
