import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { projects } from './projects'

export const UPLOAD_BATCH_SCOPES = ['project', 'office_shelf', 'session'] as const
export type UploadBatchScope = (typeof UPLOAD_BATCH_SCOPES)[number]

export interface UploadBatchExclusion {
  term: string
  count: number
}

export const UPLOAD_BATCH_REVISION_NOTICES = ['all', 'marks_only'] as const
export type UploadBatchRevisionNotice = (typeof UPLOAD_BATCH_REVISION_NOTICES)[number]

export interface UploadBatchEffects {
  announcesCompletion: boolean
  reviewsFiling: boolean
  startsIntake: boolean
  revisionNotice: UploadBatchRevisionNotice
  runsDocumentCheck: boolean
}

export const DEFAULT_UPLOAD_BATCH_EFFECTS: Readonly<UploadBatchEffects> = Object.freeze({
  announcesCompletion: true,
  reviewsFiling: true,
  startsIntake: true,
  revisionNotice: 'all',
  runsDocumentCheck: true,
})

export const uploadBatches = pgTable(
  'upload_batches',
  {
    id: uuid('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    createdBy: text('created_by').notNull(),
    scope: text('scope').$type<UploadBatchScope>().notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id'),
    expectedCount: integer('expected_count').notNull(),
    excluded: jsonb('excluded').$type<UploadBatchExclusion[]>().notNull().default([]),
    unchangedCount: integer('unchanged_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    sealedAt: timestamp('sealed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    announcesCompletion: boolean('announces_completion').notNull().default(true),
    reviewsFiling: boolean('reviews_filing').notNull().default(true),
    startsIntake: boolean('starts_intake').notNull().default(true),
    revisionNotice: text('revision_notice').$type<UploadBatchRevisionNotice>().notNull().default('all'),
    runsDocumentCheck: boolean('runs_document_check').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => ({
    projectCreatedIdx: index('upload_batches_project_created_idx').on(
      table.organizationId,
      table.projectId,
      table.createdAt
    ),
  })
)

export type UploadBatch = typeof uploadBatches.$inferSelect
export type NewUploadBatch = typeof uploadBatches.$inferInsert
