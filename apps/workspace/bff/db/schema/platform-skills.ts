import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { skillCategories } from './skill-categories'

export const PLATFORM_SKILL_DELIVERIES = ['offer'] as const
export type PlatformSkillDelivery = (typeof PLATFORM_SKILL_DELIVERIES)[number]

export const platformSkills = pgTable(
  'platform_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    body: text('body').notNull(),
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
    published: boolean('published').notNull().default(false),
    delivery: text('delivery').$type<PlatformSkillDelivery>().notNull().default('offer'),
    categoryId: uuid('category_id').references(() => skillCategories.id, {
      onDelete: 'set null',
    }),
    createdBy: text('created_by').notNull(),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: uniqueIndex('idx_platform_skills_name').on(table.name),
  })
)

export type PlatformSkillRow = typeof platformSkills.$inferSelect
export type NewPlatformSkillRow = typeof platformSkills.$inferInsert
