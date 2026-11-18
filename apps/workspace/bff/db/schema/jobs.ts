import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { skillCategories } from './skill-categories'

export const SKILL_ORIGINS = ['org', 'platform-clone'] as const
export type SkillOrigin = (typeof SKILL_ORIGINS)[number]

export const JOB_OUTPUTS = ['chat', 'deep-research'] as const
export type JobOutput = (typeof JOB_OUTPUTS)[number]

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    body: text('body').notNull(),
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
    origin: text('origin').$type<SkillOrigin>().notNull().default('org'),
    clonedFrom: text('cloned_from'),
    categoryId: uuid('category_id').references(() => skillCategories.id, {
      onDelete: 'set null',
    }),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: text('created_by').notNull(),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgNameIdx: uniqueIndex('idx_skills_org_name').on(table.organizationId, table.name),
    orgIdx: index('idx_skills_organization_id').on(table.organizationId),
  })
)

export type Skill = typeof skills.$inferSelect
export type NewSkill = typeof skills.$inferInsert
