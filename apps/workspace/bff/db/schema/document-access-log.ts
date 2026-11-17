import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { DOWNLOAD_LOG_KINDS, DOWNLOAD_LOG_SCOPES, DOWNLOAD_LOG_STORED_SCOPES } from '@/lib/download-log/kinds'

export { DOWNLOAD_LOG_KINDS, DOWNLOAD_LOG_SCOPES }
export type { DownloadLogKind, DownloadLogScope } from '@/lib/download-log/kinds'

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

export const documentAccessLog = pgTable(
  'document_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    userId: text('user_id').notNull(),
    kind: text('kind', { enum: DOWNLOAD_LOG_KINDS }).notNull(),
    scope: text('scope', { enum: DOWNLOAD_LOG_STORED_SCOPES }).notNull(),
    projectId: uuid('project_id'),
    documentId: uuid('document_id').notNull(),
    documentName: text('document_name').notNull(),
    versionId: uuid('version_id'),
    folderId: uuid('folder_id'),
    ownList: boolean('own_list').notNull().default(false),
  },
  (table) => ({
    kindCheck: check('document_access_log_kind_check', sql`${table.kind} IN (${list(DOWNLOAD_LOG_KINDS)})`),
    scopeCheck: check('document_access_log_scope_check', sql`${table.scope} IN (${list(DOWNLOAD_LOG_STORED_SCOPES)})`),
    scopeProject: check(
      'document_access_log_scope_project',
      sql`(${table.scope} = 'project') = (${table.projectId} IS NOT NULL)`
    ),
    folderNeedsProject: check(
      'document_access_log_folder_needs_project',
      sql`${table.folderId} IS NULL OR ${table.projectId} IS NOT NULL`
    ),
    openNeedsOwnList: check(
      'document_access_log_open_needs_own_list',
      sql`${table.kind} = 'download' OR ${table.ownList}`
    ),
    nameLength: check('document_access_log_name_length', sql`char_length(${table.documentName}) BETWEEN 1 AND 500`),
    byTime: index('document_access_log_org_time_idx').on(
      table.organizationId,
      table.occurredAt.desc(),
      table.id.desc()
    ),
    byPerson: index('document_access_log_org_user_idx').on(
      table.organizationId,
      table.userId,
      table.occurredAt.desc(),
      table.id.desc()
    ),
    byDocument: index('document_access_log_org_document_idx').on(
      table.organizationId,
      table.documentId,
      table.occurredAt.desc(),
      table.id.desc()
    ),
    purge: index('document_access_log_occurred_idx').on(table.occurredAt),
  })
)

export type DocumentAccessLogRow = typeof documentAccessLog.$inferSelect
export type NewDocumentAccessLogRow = typeof documentAccessLog.$inferInsert
