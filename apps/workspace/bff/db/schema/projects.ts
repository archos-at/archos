import { check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import type { ProjectOutcome, ProjectStatus } from '../../projects/project-status'

import type { ProjectProfile, ProjectProfileDisplay } from '../../project-profile/types'

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    createdBy: text('created_by').notNull(),
    collectionName: text('collection_name').notNull(),
    workosResourceId: text('workos_resource_id').unique(),
    profile: jsonb('profile')
      .$type<ProjectProfile>()
      .notNull()
      .default({ facts: {}, goals: {}, unknowns: [], assumptions: {} }),
    profileVersion: integer('profile_version').notNull().default(1),
    profilePromptView: text('profile_prompt_view'),
    profileDisplay: jsonb('profile_display').$type<ProjectProfileDisplay>(),
    profileUpdatedAt: timestamp('profile_updated_at', { withTimezone: true }),
    status: text('status').$type<ProjectStatus>().notNull().default('active'),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    closedOutcome: text('closed_outcome').$type<ProjectOutcome>(),
    startedOn: date('started_on', { mode: 'string' }),
    endedOn: date('ended_on', { mode: 'string' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('projects_org_deleted_created_idx').on(
      table.organizationId,
      table.deletedAt,
      table.createdAt
    ),
    idOrgKey: unique('projects_id_organization_id_key').on(table.id, table.organizationId),
    orgStatusIdx: index('projects_org_status_idx')
      .on(table.organizationId, table.status)
      .where(sql`${table.deletedAt} IS NULL`),
    statusCheck: check('projects_status_check', sql`${table.status} IN ('active', 'paused', 'closed')`),
    pausedStateCheck: check('projects_paused_state_check', sql`(${table.status} = 'paused') = (${table.pausedAt} IS NOT NULL)`),
    closedOutcomeCheck: check(
      'projects_closed_outcome_check',
      sql`(${table.status} <> 'closed' OR ${table.closedOutcome} IS NOT NULL) AND (${table.closedOutcome} IS NULL OR ${table.closedOutcome} IN ('completed', 'cancelled')) AND (${table.status} <> 'closed' OR ${table.endedOn} IS NOT NULL)`
    ),
    periodCheck: check(
      'projects_period_check',
      sql`(${table.startedOn} IS NULL OR extract(day FROM ${table.startedOn}) = 1) AND (${table.endedOn} IS NULL OR extract(day FROM ${table.endedOn}) = 1) AND (${table.startedOn} IS NULL OR ${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn})`
    ),
    profileShapeCheck: check(
      'projects_profile_shape_check',
      sql`jsonb_typeof(${table.profile}->'facts') IS NOT DISTINCT FROM 'object' AND jsonb_typeof(${table.profile}->'goals') IS NOT DISTINCT FROM 'object' AND jsonb_typeof(${table.profile}->'unknowns') IS NOT DISTINCT FROM 'array' AND jsonb_typeof(${table.profile}->'assumptions') IS NOT DISTINCT FROM 'object'`
    ),
    closedStateCheck: check(
      'projects_closed_state_check',
      sql`(${table.status} = 'closed') = (${table.closedAt} IS NOT NULL) AND (${table.status} = 'closed') = (${table.closedBy} IS NOT NULL)`
    ),
  })
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
