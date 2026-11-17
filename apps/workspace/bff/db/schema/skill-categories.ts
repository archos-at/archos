import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const skillCategories = pgTable(
  'skill_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id'),
    name: text('name').notNull(),
    description: text('description'),
    slug: text('slug'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: text('created_by').notNull(),
    createdByEmail: text('created_by_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    platformNameIdx: uniqueIndex('idx_skill_categories_platform_name')
      .on(table.name)
      .where(sql`${table.organizationId} IS NULL`),
    orgNameIdx: uniqueIndex('idx_skill_categories_org_name')
      .on(table.organizationId, table.name)
      .where(sql`${table.organizationId} IS NOT NULL`),
    platformSlugIdx: uniqueIndex('idx_skill_categories_platform_slug')
      .on(table.slug)
      .where(sql`${table.organizationId} IS NULL AND ${table.slug} IS NOT NULL`),
    orgIdx: index('idx_skill_categories_organization_id').on(table.organizationId),
  })
)

export type SkillCategoryRow = typeof skillCategories.$inferSelect
export type NewSkillCategoryRow = typeof skillCategories.$inferInsert
