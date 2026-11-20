import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  check,
  foreignKey,
  index,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { projects } from './projects'
import { projectFolders } from './project-folders'
import { conversations } from './conversations'
import { type ResourceVisibility } from './resource-shares'

export const DOCUMENT_SCOPES = ['project', 'office_shelf', 'session'] as const
export type DocumentScope = (typeof DOCUMENT_SCOPES)[number]

export const LEGACY_DOCUMENT_SCOPES: Readonly<Record<string, DocumentScope>> = { archiv: 'office_shelf' }

export const modernizeDocumentScope = <T extends string>(scope: T): Exclude<T, 'archiv'> | DocumentScope =>
  (LEGACY_DOCUMENT_SCOPES[scope] ?? scope) as Exclude<T, 'archiv'> | DocumentScope

export const DOCUMENT_SCREENING_OUTCOMES = ['clean', 'partial', 'unchecked', 'quarantined', 'released'] as const
export type DocumentScreeningOutcome = (typeof DOCUMENT_SCREENING_OUTCOMES)[number]

import {
  AUTHORED_REF_KINDS,
  DOCUMENT_AUTHORS,
  type AuthoredRefKind,
  type DocumentAuthor,
} from '@/lib/documents/document-authors'
import { DOCUMENT_LIFECYCLES, type DocumentLifecycle } from '@/lib/documents/lifecycle-vocabulary'
import { DOCUMENT_STATUSES, type DocumentStatus } from '@/lib/documents/document-status'
import type { IngestFailureCategory } from '@/lib/documents/retry-policy'
import type { StoredQuarantineVerdict } from '@/lib/upload-screening/quarantine'

export { AUTHORED_REF_KINDS, DOCUMENT_AUTHORS, type AuthoredRefKind, type DocumentAuthor }
export { DOCUMENT_LIFECYCLES, type DocumentLifecycle }

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  scope: text('scope').$type<DocumentScope>().notNull().default('project'),
  conversationId: text('conversation_id'),
  createdBy: text('created_by').notNull(),
  authoredBy: text('authored_by').$type<DocumentAuthor>().notNull().default('user'),
  authoredByProducer: text('authored_by_producer'),
  authoredByRef: text('authored_by_ref'),
  authoredByRefKind: text('authored_by_ref_kind').$type<AuthoredRefKind>(),
  visibility: text('visibility').$type<ResourceVisibility>().notNull().default('project'),
  filename: text('filename').notNull(),
  displayName: text('display_name'),
  storageKey: text('storage_key').notNull(),
  storageBucket: text('storage_bucket'),
  collectionName: text('collection_name').notNull(),
  fileSize: integer('file_size'),
  contentType: text('content_type'),
  originPath: text('origin_path'),
  contentHash: text('content_hash'),
  status: text('status').$type<DocumentStatus>().notNull().default('uploaded'),
  publishedVersionId: uuid('published_version_id'),
  lifecycle: text('lifecycle').$type<DocumentLifecycle>().notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  errorMessage: text('error_message'),
  metadata: jsonb('metadata'),
  screeningOutcome: text('screening_outcome').$type<DocumentScreeningOutcome>(),
  quarantine: jsonb('quarantine').$type<StoredQuarantineVerdict | null>(),
  screenedHash: text('screened_hash'),
  screeningReleasedHash: text('screening_released_hash'),
  screeningReleasedBy: text('screening_released_by'),
  screeningReleasedAt: timestamp('screening_released_at', { withTimezone: true }),
  ingestFailureCategory: text('ingest_failure_category').$type<IngestFailureCategory>(),
  ingestRetryable: boolean('ingest_retryable'),
  ingestReaderVersion: text('ingest_reader_version'),
  ingestAttempts: integer('ingest_attempts'),
  uploadBatchId: uuid('upload_batch_id'),
  folderId: uuid('folder_id'),
}, (table) => ({
    idProjectKey: unique('documents_id_project_id_key').on(table.id, table.projectId),
  projectIdx: index('documents_project_idx').on(table.projectId),
  collectionIdx: index('documents_collection_idx').on(table.collectionName),
  statusIdx: index('documents_status_idx').on(table.status),
  orgScopeIdx: index('documents_org_scope_idx').on(table.organizationId, table.scope),
  projectFolderListingIdx: index('documents_project_folder_listing_idx').on(
    table.projectId,
    table.folderId,
    table.createdAt.desc(),
    table.id
  ),
  orgScopeFolderListingIdx: index('documents_org_scope_folder_listing_idx').on(
    table.organizationId,
    table.scope,
    table.folderId,
    table.createdAt.desc(),
    table.id
  ),
  liveNamePerCollectionUidx: uniqueIndex('uniq_documents_live_name_per_collection')
    .on(table.organizationId, table.collectionName, table.filename)
    .where(sql`${table.authoredBy} = 'user' OR ${table.authoredByProducer} IN ('agent_document', 'agent_file')`),
  folderProjectFk: foreignKey({
    name: 'documents_folder_id_project_id_fkey',
    columns: [table.folderId, table.projectId],
    foreignColumns: [projectFolders.id, projectFolders.projectId],
  }).onDelete('cascade'),
  folderShelfFk: foreignKey({
    name: 'documents_folder_id_organization_id_scope_fkey',
    columns: [table.folderId, table.organizationId, table.scope],
    foreignColumns: [projectFolders.id, projectFolders.organizationId, projectFolders.scope],
  }).onDelete('cascade'),
  folderRequiresShelf: check(
    'documents_folder_requires_project',
    sql`${table.folderId} IS NULL OR ${table.projectId} IS NOT NULL OR ${table.scope} = 'office_shelf'`
  ),
  conversationFk: foreignKey({
    name: 'documents_conversation_id_organization_id_fkey',
    columns: [table.conversationId, table.organizationId],
    foreignColumns: [conversations.id, conversations.organizationId],
  }).onDelete('cascade'),
  sessionRequiresConversation: check(
    'documents_session_requires_conversation',
    sql`(${table.scope} = 'session') = (${table.conversationId} IS NOT NULL) AND (${table.scope} <> 'session' OR ${table.projectId} IS NULL)`
  ),
  lifecycleKnown: check('documents_lifecycle_known', sql`${table.lifecycle} IN ('active', 'archived')`),
  statusKnown: check(
    'documents_status_known',
    sql`${table.status} IN (${sql.raw(DOCUMENT_STATUSES.map((status) => `'${status}'`).join(', '))})`
  ),
  quarantineShape: check(
    'documents_quarantine_shape_check',
    sql`${table.quarantine} IS NULL OR (jsonb_typeof(${table.quarantine}) = 'object' AND jsonb_typeof(${table.quarantine}->'reasons') IS NOT DISTINCT FROM 'array')`
  ),
  quarantineHeld: check(
    'documents_quarantine_held_check',
    sql`${table.quarantine} IS NULL OR ${table.status} = 'quarantined'`
  ),
  ingestFailureCategoryKnown: check(
    'documents_ingest_failure_category_check',
    sql`${table.ingestFailureCategory} IS NULL OR ${table.ingestFailureCategory} IN ('transient', 'configuration', 'deterministic', 'quarantined', 'unknown')`
  ),
  authorshipRequiresProvenance: check(
    'documents_authorship_requires_provenance',
    sql`${table.authoredBy} = 'user' OR (${table.authoredByProducer} IS NOT NULL AND ${table.authoredByRef} IS NOT NULL AND ${table.authoredByRefKind} IS NOT NULL)`
  ),
}))

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
