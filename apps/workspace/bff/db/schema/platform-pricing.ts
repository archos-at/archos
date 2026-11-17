import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const PRICING_VERSION_STATUSES = ['active', 'superseded'] as const
export type PricingVersionStatus = (typeof PRICING_VERSION_STATUSES)[number]

export const platformPricingVersions = pgTable('platform_pricing_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  marginMultiplier: numeric('margin_multiplier', { precision: 8, scale: 4 }).notNull(),
  usdPerCredit: numeric('usd_per_credit', { precision: 10, scale: 6 }).notNull(),
  defaultOrgDailyCredits: numeric('default_org_daily_credits', { precision: 14, scale: 4 }),
  defaultOrgMonthlyCredits: numeric('default_org_monthly_credits', { precision: 14, scale: 4 }),
  status: text('status').$type<PricingVersionStatus>().notNull().default('active'),
  supersedesId: uuid('supersedes_id'),
  note: text('note'),
  createdBy: text('created_by').notNull(),
  createdByEmail: text('created_by_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PlatformPricingVersion = typeof platformPricingVersions.$inferSelect
export type NewPlatformPricingVersion = typeof platformPricingVersions.$inferInsert
