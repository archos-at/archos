import { sql } from 'drizzle-orm'
import { check, date, foreignKey, index, integer, pgTable, real, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { documents } from './documents'
import { projects } from './projects'

export const PERMIT_RECORD_KINDS = ['approval', 'information_request', 'refusal', 'other'] as const
export type PermitRecordKind = (typeof PERMIT_RECORD_KINDS)[number]

export const LEGACY_PERMIT_RECORD_KINDS: Readonly<Record<string, PermitRecordKind>> = {
  bewilligung: 'approval',
  nachforderung: 'information_request',
  ablehnung: 'refusal',
  sonstiges: 'other',
}

export const PERMIT_REQUIREMENT_KINDS = ['condition', 'information_request', 'note'] as const
export type PermitRequirementKind = (typeof PERMIT_REQUIREMENT_KINDS)[number]

export const LEGACY_PERMIT_REQUIREMENT_KINDS: Readonly<Record<string, PermitRequirementKind>> = {
  auflage: 'condition',
  nachforderung: 'information_request',
  hinweis: 'note',
}

export const canonicalPermitRecordKind = (value: unknown): unknown =>
  typeof value === 'string' ? (LEGACY_PERMIT_RECORD_KINDS[value] ?? value) : value

export const canonicalPermitRequirementKind = (value: unknown): unknown =>
  typeof value === 'string' ? (LEGACY_PERMIT_REQUIREMENT_KINDS[value] ?? value) : value

export const PERMIT_MAX_RESTRICTED_FOLDERS = 20

export const PERMIT_REQUIREMENT_MAX_CHARS = 1000

export const permitRecords = pgTable(
  'permit_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    documentId: uuid('document_id').notNull(),
    collectionName: text('collection_name').notNull(),
    fileName: text('file_name').notNull(),
    restrictedFolderIds: uuid('restricted_folder_ids').array(),
    kind: text('kind').$type<PermitRecordKind>().notNull(),
    authority: text('authority'),
    municipality: text('municipality'),
    federalState: text('federal_state'),
    issuedOn: date('issued_on', { mode: 'string' }),
    reference: text('reference'),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentKey: unique('permit_records_document_key').on(table.documentId),
    projectFk: foreignKey({
      name: 'permit_records_project_fkey',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    documentFk: foreignKey({
      name: 'permit_records_document_fkey',
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
    projectIdx: index('permit_records_project_idx').on(table.projectId),
    organizationIdx: index('permit_records_organization_idx').on(table.organizationId),
    kindCheck: check('permit_records_kind_check', sql`${table.kind} IN ('approval', 'information_request', 'refusal', 'other')`),
    restrictedFoldersCheck: check(
      'permit_records_restricted_folders_check',
      sql`${table.restrictedFolderIds} IS NULL OR cardinality(${table.restrictedFolderIds}) BETWEEN 1 AND 20`
    ),
  })
)

export const permitRequirements = pgTable(
  'permit_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    recordId: uuid('record_id').notNull(),
    projectId: uuid('project_id').notNull(),
    restrictedFolderIds: uuid('restricted_folder_ids').array(),
    position: integer('position').notNull(),
    kind: text('kind').$type<PermitRequirementKind>().notNull(),
    content: text('content').notNull(),
    evidence: text('evidence'),
    legalBasis: text('legal_basis'),
    page: integer('page'),
    embedding: real('embedding').array(),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recordFk: foreignKey({
      name: 'permit_requirements_record_fkey',
      columns: [table.recordId],
      foreignColumns: [permitRecords.id],
    }).onDelete('cascade'),
    projectIdx: index('permit_requirements_project_idx').on(table.projectId),
    recordIdx: index('permit_requirements_record_idx').on(table.recordId),
    organizationIdx: index('permit_requirements_organization_idx').on(table.organizationId),
    kindCheck: check('permit_requirements_kind_check', sql`${table.kind} IN ('condition', 'information_request', 'note')`),
    contentLength: check('permit_requirements_content_length', sql`char_length(${table.content}) <= 1000`),
    restrictedFoldersCheck: check(
      'permit_requirements_restricted_folders_check',
      sql`${table.restrictedFolderIds} IS NULL OR cardinality(${table.restrictedFolderIds}) BETWEEN 1 AND 20`
    ),
  })
)

export type PermitRecordRow = typeof permitRecords.$inferSelect
export type NewPermitRecordRow = typeof permitRecords.$inferInsert
export type PermitRequirementRow = typeof permitRequirements.$inferSelect
export type NewPermitRequirementRow = typeof permitRequirements.$inferInsert
