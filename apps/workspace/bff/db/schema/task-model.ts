import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PlanDocuments } from '@/lib/runs/plan-documents'
import type { SkillSnapshot } from '@/lib/skills/types'
import {
  DEFINITION_TRIGGERS,
  DELEGATABLE_TASK_KINDS,
  TASK_KINDS,
  TASK_REVIEWS,
  TASK_RUN_STATUSES,
  TASK_RUN_TRIGGERS,
  TASK_STATUSES,
  type DefinitionTrigger,
  type TaskKind,
  type TaskReview,
  type TaskRunStatus,
  type TaskRunTrigger,
  type TaskStatus,
} from '@/lib/tasks/task-vocabulary'
import { projects } from './projects'

export { TASK_KINDS, type TaskKind }

export { DELEGATABLE_TASK_KINDS }
export type DelegatableTaskKind = (typeof DELEGATABLE_TASK_KINDS)[number]

export { TASK_STATUSES, type TaskStatus, TASK_REVIEWS, type TaskReview }

export const TASK_FILING_STATUSES = ['queued', 'filed', 'refused', 'failed'] as const
export type TaskFilingStatus = (typeof TASK_FILING_STATUSES)[number]

export interface TaskPlan {
  prompt: string
  skill: SkillSnapshot
  dataSources: string[] | null
  context?: string | null
  documents?: PlanDocuments | null
  goal?: string | null
  subject?: {
    documentId: string
    versionId: string
    comment: string
  } | null
}

export const taskDefinitions = pgTable(
  'task_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TaskKind>().notNull(),
    title: text('title').notNull(),
    plan: jsonb('plan').$type<TaskPlan>().notNull(),
    requesterUserId: text('requester_user_id').notNull(),
    requesterEmail: text('requester_email'),
    trigger: text('trigger').$type<DefinitionTrigger>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    scheduleCron: text('schedule_cron'),
    scheduleTimezone: text('schedule_timezone').notNull().default('UTC'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    scheduledRunId: text('scheduled_run_id'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    budgetUsd: numeric('budget_usd', { precision: 12, scale: 4 }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectCreatedIdx: index('idx_task_definitions_project_created').on(
      table.projectId,
      table.createdAt
    ),
    orgIdx: index('idx_task_definitions_organization_id').on(table.organizationId),
    idOrganizationProjectKey: unique('task_definitions_id_organization_id_project_id_key').on(
      table.id,
      table.organizationId,
      table.projectId
    ),
    triggerKnown: check(
      'task_definitions_trigger_known',
      sql`${table.trigger} IN ('manual', 'once', 'schedule')`
    ),
    cronOnlyWhenScheduled: check(
      'task_definitions_cron_only_when_scheduled',
      sql`(${table.trigger} = 'schedule') = (${table.scheduleCron} IS NOT NULL)`
    ),
    dueOnlyWhenOnce: check(
      'task_definitions_due_only_when_once',
      sql`${table.dueAt} IS NULL OR ${table.trigger} = 'once'`
    ),
  })
)

export const taskRuns = pgTable(
  'task_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    definitionId: uuid('definition_id'),
    kind: text('kind').$type<TaskKind>().notNull(),
    title: text('title').notNull(),
    plan: jsonb('plan').$type<TaskPlan>().notNull(),
    requesterUserId: text('requester_user_id').notNull(),
    requesterEmail: text('requester_email'),
    trigger: text('trigger').$type<TaskRunTrigger>().notNull(),
    triggeredBy: text('triggered_by'),
    status: text('status').$type<TaskRunStatus>().notNull(),
    error: text('error'),
    skillSnapshot: jsonb('skill_snapshot').$type<SkillSnapshot>().notNull(),
    backendJobId: text('backend_job_id'),
    conversationId: text('conversation_id'),
    runMessageId: uuid('run_message_id'),
    filedDocumentId: uuid('filed_document_id'),
    filingStatus: text('filing_status').$type<TaskFilingStatus>(),
    filingDetail: text('filing_detail'),
    review: text('review').$type<TaskReview>(),
    reviewReason: text('review_reason'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    reconcileCheckedAt: timestamp('reconcile_checked_at', { withTimezone: true }),
  },
  (table) => ({
    definitionCreatedIdx: index('idx_task_runs_definition_created').on(
      table.definitionId,
      table.createdAt
    ),
    projectCreatedIdx: index('idx_task_runs_project_created').on(table.projectId, table.createdAt),
    orgIdx: index('idx_task_runs_organization_id').on(table.organizationId),
    revisionConversationIdx: index('idx_task_runs_revision_conversation')
      .on(table.organizationId, table.conversationId)
      .where(sql`${table.kind} = 'revision'`),
    backendJobUidx: uniqueIndex('uniq_task_runs_backend_job_id')
      .on(table.backendJobId)
      .where(sql`${table.backendJobId} IS NOT NULL`),
    statusKnown: check(
      'task_runs_status_known',
      sql`${table.status} IN (${sql.join(
        TASK_RUN_STATUSES.map((status) => sql`${status}`),
        sql`, `
      )})`
    ),
    triggerKnown: check(
      'task_runs_trigger_known',
      sql`${table.trigger} IN (${sql.join(
        TASK_RUN_TRIGGERS.map((trigger) => sql`${trigger}`),
        sql`, `
      )})`
    ),
    reviewKnown: check(
      'task_runs_review_known',
      sql`${table.review} IS NULL OR ${table.review} IN ('accepted', 'rejected')`
    ),
    filingKnown: check(
      'task_runs_filing_status_known',
      sql`${table.filingStatus} IS NULL OR ${table.filingStatus} IN ('queued', 'filed', 'refused', 'failed')`
    ),
    reviewComplete: check(
      'task_runs_review_complete',
      sql`(${table.review} IS NULL) = (${table.reviewedBy} IS NULL) AND (${table.review} IS NULL) = (${table.reviewedAt} IS NULL)`
    ),
  })
)

export const taskDefinitionsRelations = relations(taskDefinitions, ({ one, many }) => ({
  project: one(projects, { fields: [taskDefinitions.projectId], references: [projects.id] }),
  runs: many(taskRuns),
}))

export const taskRunsRelations = relations(taskRuns, ({ one }) => ({
  project: one(projects, { fields: [taskRuns.projectId], references: [projects.id] }),
  definition: one(taskDefinitions, {
    fields: [taskRuns.definitionId],
    references: [taskDefinitions.id],
  }),
}))

export type TaskDefinition = typeof taskDefinitions.$inferSelect
export type NewTaskDefinition = typeof taskDefinitions.$inferInsert
export type TaskRun = typeof taskRuns.$inferSelect
export type NewTaskRun = typeof taskRuns.$inferInsert

export { DEFINITION_TRIGGERS, type DefinitionTrigger, TASK_RUN_TRIGGERS, type TaskRunTrigger, TASK_RUN_STATUSES, type TaskRunStatus }
