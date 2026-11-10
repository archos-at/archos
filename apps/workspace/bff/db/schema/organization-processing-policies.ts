import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * What an organization's data may be processed for (migration 0205, ADR-0167).
 *
 * One row per organization; no row reads as the defaults (`DEFAULT_PURPOSES` in
 * `bff/residency/processing-policy.ts`). `service` is always allowed and
 * `product_improvement` is opt-in, both held by CHECK constraints. `version`
 * moves with every write, so a trace names the policy it ran under.
 */
export const organizationProcessingPolicies = pgTable('organization_processing_policies', {
  organizationId: text('organization_id').primaryKey(),
  version: integer('version').notNull().default(1),
  purposesAllowed: text('purposes_allowed').array().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
})

export type OrganizationProcessingPolicy = typeof organizationProcessingPolicies.$inferSelect
