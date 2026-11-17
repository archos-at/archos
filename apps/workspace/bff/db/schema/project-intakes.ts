import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { GeocodeResult } from '@/lib/geocoding/types'
import {
  INTAKE_MODES,
  INTAKE_STATUSES,
  MAX_INTAKE_DESCRIPTION_LENGTH,
  type ClosingIntent,
  type DismissedValue,
  type DocumentRead,
  type IntakeCounts,
  type IntakeMode,
  type IntakeStatus,
} from '@/lib/project-intake/types'
import { projects } from './projects'

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

export const projectIntakes = pgTable(
  'project_intakes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    createdBy: text('created_by').notNull(),
    mode: text('mode').$type<IntakeMode>().notNull().default('active'),
    description: text('description'),
    location: jsonb('location').$type<GeocodeResult>(),
    closing: jsonb('closing').$type<ClosingIntent>(),
    status: text('status').$type<IntakeStatus>().notNull().default('waiting'),
    jobId: text('job_id'),
    requestedBy: text('requested_by'),
    traceId: text('trace_id'),
    rerunRequested: boolean('rerun_requested').notNull().default(false),
    documentsRead: jsonb('documents_read').$type<DocumentRead[]>().notNull().default(sql`'[]'::jsonb`),
    dismissed: jsonb('dismissed').$type<DismissedValue[]>().notNull().default(sql`'[]'::jsonb`),
    readingFiles: jsonb('reading_files').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    counts: jsonb('counts').$type<IntakeCounts>(),
    summary: text('summary'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: text('completed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectFk: foreignKey({
      name: 'project_intakes_project_fkey',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    projectUidx: uniqueIndex('uniq_project_intakes_project').on(table.projectId),
    jobUidx: uniqueIndex('uniq_project_intakes_job')
      .on(table.jobId)
      .where(sql`${table.jobId} IS NOT NULL`),
    organizationIdx: index('idx_project_intakes_organization_id').on(table.organizationId),
    statusKnown: check('project_intakes_status_known', sql`${table.status} IN (${list(INTAKE_STATUSES)})`),
    modeKnown: check('project_intakes_mode_known', sql`${table.mode} IN (${list(INTAKE_MODES)})`),
    closingWhenClosing: check(
      'project_intakes_closing_when_closing',
      sql`(${table.mode} = 'closing') = (${table.closing} IS NOT NULL)`
    ),
    closingObject: check(
      'project_intakes_closing_object',
      sql`${table.closing} IS NULL OR jsonb_typeof(${table.closing}) = 'object'`
    ),
    locationObject: check(
      'project_intakes_location_object',
      sql`${table.location} IS NULL OR jsonb_typeof(${table.location}) = 'object'`
    ),
    countsObject: check(
      'project_intakes_counts_object',
      sql`${table.counts} IS NULL OR jsonb_typeof(${table.counts}) = 'object'`
    ),
    descriptionLength: check(
      'project_intakes_description_length',
      sql`${table.description} IS NULL OR char_length(${table.description}) <= ${sql.raw(String(MAX_INTAKE_DESCRIPTION_LENGTH))}`
    ),
    completionComplete: check(
      'project_intakes_completion_complete',
      sql`(${table.status} = 'completed') = (${table.completedAt} IS NOT NULL) AND (${table.completedAt} IS NULL) = (${table.completedBy} IS NULL)`
    ),
    jobWhenReading: check(
      'project_intakes_job_when_reading',
      sql`${table.status} <> 'reading' OR ${table.jobId} IS NOT NULL`
    ),
    documentsReadArray: check(
      'project_intakes_documents_read_array',
      sql`jsonb_typeof(${table.documentsRead}) = 'array'`
    ),
    dismissedArray: check('project_intakes_dismissed_array', sql`jsonb_typeof(${table.dismissed}) = 'array'`),
    readingFilesArray: check('project_intakes_reading_files_array', sql`jsonb_typeof(${table.readingFiles}) = 'array'`),
  })
)

export type ProjectIntakeRow = typeof projectIntakes.$inferSelect
export type NewProjectIntakeRow = typeof projectIntakes.$inferInsert
