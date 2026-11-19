import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { documents } from './documents'
import { projectFolders } from './project-folders'
import { projects } from './projects'
import type { ReferencePlacement } from '@/lib/office-shelf/project-norms/wire'

export const officeShelfReferences = pgTable(
  'office_shelf_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id').references(() => projectFolders.id, { onDelete: 'cascade' }),
    sourceDocumentId: uuid('source_document_id').notNull(),
    officeDocumentId: uuid('office_document_id'),
    fileName: text('file_name').notNull(),
    placedAs: text('placed_as').$type<ReferencePlacement>().notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectFk: foreignKey({
      name: 'office_shelf_references_project_fkey',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    officeDocumentFk: foreignKey({
      name: 'office_shelf_references_office_document_fkey',
      columns: [table.officeDocumentId, table.organizationId],
      foreignColumns: [documents.id, documents.organizationId],
    }).onDelete('set null'),
    placedAsKnown: check('office_shelf_references_placed_as_known', sql`${table.placedAs} IN ('moved', 'edition', 'duplicate')`),
    sourceOnce: unique('office_shelf_references_source_once').on(table.projectId, table.sourceDocumentId),
    folderIdx: index('idx_office_shelf_references_folder').on(table.projectId, table.folderId, table.createdAt),
  })
)

export type OfficeShelfReference = typeof officeShelfReferences.$inferSelect

export const officeShelfNormKeeps = pgTable(
  'office_shelf_norm_keeps',
  {
    documentId: uuid('document_id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    keptBy: text('kept_by').notNull(),
    keptAt: timestamp('kept_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentFk: foreignKey({
      name: 'office_shelf_norm_keeps_document_fkey',
      columns: [table.documentId, table.organizationId],
      foreignColumns: [documents.id, documents.organizationId],
    }).onDelete('cascade'),
    projectFk: foreignKey({
      name: 'office_shelf_norm_keeps_project_fkey',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    projectIdx: index('idx_office_shelf_norm_keeps_project').on(table.organizationId, table.projectId),
  })
)
