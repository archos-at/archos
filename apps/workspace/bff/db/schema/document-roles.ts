import { pgTable, uuid, text, timestamp, index, foreignKey, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { projects } from './projects'
import { documents } from './documents'

export const documentRoles = pgTable(
  'document_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    documentId: uuid('document_id').notNull(),
    role: text('role').notNull(),
    scopeInstanceId: text('scope_instance_id'),
    confidence: text('confidence').notNull().default('declared'),
    source: text('source').notNull().default('user'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectRoleIdx: index('document_roles_project_role_idx').on(table.projectId, table.role),
    documentIdx: index('document_roles_document_idx').on(table.documentId),
    documentProjectFk: foreignKey({
      name: 'document_roles_document_id_project_id_fkey',
      columns: [table.documentId, table.projectId],
      foreignColumns: [documents.id, documents.projectId],
    }).onDelete('cascade'),
    projectOrgFk: foreignKey({
      name: 'document_roles_project_id_organization_id_fkey',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    scopeInstanceNotBlank: check(
      'document_roles_scope_instance_not_blank',
      sql`${table.scopeInstanceId} IS NULL OR length(${table.scopeInstanceId}) > 0`
    ),
    confidenceKnown: check(
      'document_roles_confidence_known',
      sql`${table.confidence} IN ('declared', 'suggested')`
    ),
    sourceKnown: check(
      'document_roles_source_known',
      sql`${table.source} IN ('user', 'wizard', 'classifier')`
    ),
  })
)

export type DocumentRoleRow = typeof documentRoles.$inferSelect
export type NewDocumentRoleRow = typeof documentRoles.$inferInsert
