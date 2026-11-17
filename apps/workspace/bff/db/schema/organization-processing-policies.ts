import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const organizationProcessingPolicies = pgTable('organization_processing_policies', {
  organizationId: text('organization_id').primaryKey(),
  version: integer('version').notNull().default(1),
  purposesAllowed: text('purposes_allowed').array().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
})

export type OrganizationProcessingPolicy = typeof organizationProcessingPolicies.$inferSelect
