import { sql } from 'drizzle-orm'
import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import { projects } from './projects'

export const MAIL_IMPORT_STATUSES = ['uploading', 'queued', 'importing', 'completed', 'failed', 'cancelled'] as const
export type MailImportStatus = (typeof MAIL_IMPORT_STATUSES)[number]

export const MAIL_IMPORT_LIFECYCLE = defineLifecycle<MailImportStatus, 'queue' | 'start' | 'complete' | 'fail' | 'cancel'>({
  id: 'mail-import',
  initial: 'uploading',
  states: {
    uploading: { on: { queue: 'queued', cancel: 'cancelled' } },
    queued: { on: { start: 'importing', complete: 'completed', fail: 'failed', cancel: 'cancelled' } },
    importing: { on: { complete: 'completed', fail: 'failed', cancel: 'cancelled' } },
    completed: { type: 'final' },
    failed: { type: 'final' },
    cancelled: { type: 'final' },
  },
})

export type MailImportSkipReason =
  | 'embedded_message'
  | 'type'
  | 'size'
  | 'unreadable'
  | 'screened'
  | 'access'
  | 'name_taken'

export type MailImportErrorCode =
  | 'unreadable'
  | 'quota'
  | 'access'
  | 'requester_left'
  | 'stopped'
  | 'stalled'
  | 'upload_expired'

export interface MailImportSkippedSample {
  mail: string
  file: string | null
  reason: MailImportSkipReason
}

export const mailImports = pgTable(
  'mail_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    userEmail: text('user_email'),
    filename: text('filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: text('status').$type<MailImportStatus>().notNull().default('uploading'),
    stagingBucket: text('staging_bucket').notNull(),
    stagingKey: text('staging_key').notNull(),
    uploadId: text('upload_id'),
    stagingDeletedAt: timestamp('staging_deleted_at', { withTimezone: true }),
    rootFolderId: uuid('root_folder_id'),
    totalItems: integer('total_items'),
    nextPosition: integer('next_position').notNull().default(0),
    inflightPosition: integer('inflight_position'),
    inflightFolderId: uuid('inflight_folder_id'),
    failureStreak: integer('failure_streak').notNull().default(0),
    mailsFiled: integer('mails_filed').notNull().default(0),
    filesFiled: integer('files_filed').notNull().default(0),
    itemsSkipped: integer('items_skipped').notNull().default(0),
    filesSkipped: integer('files_skipped').notNull().default(0),
    threadsCreated: integer('threads_created').notNull().default(0),
    threadsAppended: integer('threads_appended').notNull().default(0),
    alreadyInProject: integer('already_in_project').notNull().default(0),
    skippedSamples: jsonb('skipped_samples').$type<MailImportSkippedSample[]>().notNull().default([]),
    errorCode: text('error_code').$type<MailImportErrorCode>(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('mail_imports_org_project_created_idx').on(table.organizationId, table.projectId, table.createdAt),
    uniqueIndex('mail_imports_one_open_per_person_uidx')
      .on(table.projectId, table.userId)
      .where(sql`${table.status} IN ('uploading', 'queued', 'importing')`),
    index('mail_imports_open_updated_idx')
      .on(table.updatedAt)
      .where(sql`${table.status} IN ('uploading', 'queued', 'importing')`),
  ],
)

export type MailImport = typeof mailImports.$inferSelect
export type NewMailImport = typeof mailImports.$inferInsert
