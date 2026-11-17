import { check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { DocumentScope } from './documents'

export const documentQuarantineDecisions = pgTable(
  'document_quarantine_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    documentId: uuid('document_id').notNull(),
    jobId: text('job_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    scope: text('scope').$type<DocumentScope>().notNull(),
    projectId: uuid('project_id'),
    folderId: uuid('folder_id'),
    filename: text('filename').notNull(),
    reasons: text('reasons').notNull().default(''),
    reasonsOmitted: integer('reasons_omitted').notNull().default(0),
    checked: text('checked').notNull().default(''),
    uploadedBy: text('uploaded_by').notNull(),
    auditedAt: timestamp('audited_at', { withTimezone: true }),
  },
  (table) => ({
    dispatchKey: unique('document_quarantine_decisions_dispatch_key').on(
      table.documentId,
      table.jobId
    ),
    scopeCheck: check(
      'document_quarantine_decisions_scope_check',
      sql`${table.scope} IN ('project', 'office_shelf', 'archiv', 'session')`
    ),
    scopeProject: check(
      'document_quarantine_decisions_scope_project',
      sql`(${table.scope} = 'project') = (${table.projectId} IS NOT NULL)`
    ),
    reasonsOmittedCheck: check(
      'document_quarantine_decisions_reasons_omitted_check',
      sql`${table.reasonsOmitted} >= 0`
    ),
    filenameLength: check(
      'document_quarantine_decisions_filename_length',
      sql`char_length(${table.filename}) BETWEEN 1 AND 500`
    ),
    due: index('document_quarantine_decisions_due_idx')
      .on(table.decidedAt)
      .where(sql`${table.auditedAt} IS NULL`),
  })
)

export type DocumentQuarantineDecision = typeof documentQuarantineDecisions.$inferSelect
