import { sql } from 'drizzle-orm'
import { check, date, foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { projects } from './projects'

export const projectPeople = pgTable(
  'project_people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    function: text('function'),
    company: text('company'),
    startedOn: date('started_on', { mode: 'string' }),
    endedOn: date('ended_on', { mode: 'string' }),
    userId: text('user_id'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectFk: foreignKey({
      name: 'project_people_project_fkey',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    projectIdx: index('project_people_project_idx').on(table.organizationId, table.projectId, table.name),
    nameLength: check('project_people_name_length', sql`char_length(btrim(${table.name})) BETWEEN 1 AND 200`),
    functionLength: check('project_people_function_length', sql`${table.function} IS NULL OR char_length(${table.function}) <= 200`),
    companyLength: check('project_people_company_length', sql`${table.company} IS NULL OR char_length(${table.company}) <= 200`),
    periodCheck: check(
      'project_people_period_check',
      sql`(${table.startedOn} IS NULL OR extract(day FROM ${table.startedOn}) = 1) AND (${table.endedOn} IS NULL OR extract(day FROM ${table.endedOn}) = 1) AND (${table.startedOn} IS NULL OR ${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn})`
    ),
  })
)

export type ProjectPersonRow = typeof projectPeople.$inferSelect
export type NewProjectPersonRow = typeof projectPeople.$inferInsert
