import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const organizationInstructions = pgTable('organization_instructions', {
  organizationId: text('organization_id').primaryKey(),
  instructions: text('instructions').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedByEmail: text('updated_by_email'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type OrganizationInstructions = typeof organizationInstructions.$inferSelect
export type NewOrganizationInstructions = typeof organizationInstructions.$inferInsert
