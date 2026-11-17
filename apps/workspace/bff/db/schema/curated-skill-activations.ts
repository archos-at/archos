import { boolean, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const curatedSkillActivations = pgTable(
  'curated_skill_activations',
  {
    organizationId: text('organization_id').notNull(),
    skillName: text('skill_name').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    updatedBy: text('updated_by').notNull(),
    updatedByEmail: text('updated_by_email'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.skillName] }),
    orgIdx: index('idx_curated_skill_activations_organization_id').on(table.organizationId),
  })
)

export type CuratedSkillActivation = typeof curatedSkillActivations.$inferSelect
export type NewCuratedSkillActivation = typeof curatedSkillActivations.$inferInsert
