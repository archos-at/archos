import { boolean, check, foreignKey, index, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { projects } from './projects'
import { documents } from './documents'
import { FOLDER_DESCRIPTION_MAX_LENGTH } from '@/lib/projects/folders'

export const FOLDER_SCOPES = ['project', 'office_shelf'] as const
export type FolderScope = (typeof FOLDER_SCOPES)[number]

export const projectFolders = pgTable('project_folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull(),
  scope: text('scope').$type<FolderScope>().notNull().default('project'),
  parentId: uuid('parent_id'),
  name: varchar('name', { length: 255 }).notNull(),
  path: varchar('path', { length: 1024 }).notNull(),
  description: text('description'),
  accessMode: text('access_mode', { enum: ['inherit', 'custom'] }).notNull().default('inherit'),
  everyoneReads: boolean('everyone_reads').notNull().default(false),
  accessChangedBy: text('access_changed_by'),
  accessChangedAt: timestamp('access_changed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by'),
  binRootId: uuid('bin_root_id'),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('idx_project_folders_project_id').on(table.projectId),
  parentIdx: index('idx_project_folders_parent_id').on(table.parentId),
  idProjectKey: unique('project_folders_id_project_id_key').on(table.id, table.projectId),
  idOrganizationScopeKey: unique('project_folders_id_organization_id_scope_key').on(
    table.id,
    table.organizationId,
    table.scope,
  ),
  scopeCheck: check('project_folders_scope_check', sql`${table.scope} IN ('project', 'office_shelf')`),
  descriptionLength: check(
    'project_folders_description_length',
    sql`${table.description} IS NULL OR (char_length(${table.description}) <= ${sql.raw(String(FOLDER_DESCRIPTION_MAX_LENGTH))} AND btrim(${table.description}) <> '')`,
  ),
  scopeOwnerCheck: check(
    'project_folders_scope_owner_check',
    sql`(${table.scope} = 'project') = (${table.projectId} IS NOT NULL)`,
  ),
  parentShelfFk: foreignKey({
    name: 'project_folders_parent_id_organization_id_scope_fkey',
    columns: [table.parentId, table.organizationId, table.scope],
    foreignColumns: [table.id, table.organizationId, table.scope],
  }),
  parentProjectFk: foreignKey({
    name: 'project_folders_parent_id_project_id_fkey',
    columns: [table.parentId, table.projectId],
    foreignColumns: [table.id, table.projectId],
  }),
}))

export const projectFoldersRelations = relations(projectFolders, ({ one, many }) => ({
  project: one(projects, { fields: [projectFolders.projectId], references: [projects.id] }),
  parent: one(projectFolders, { fields: [projectFolders.parentId], references: [projectFolders.id] }),
  children: many(projectFolders),
  documents: many(documents),
}))

export type ProjectFolder = typeof projectFolders.$inferSelect
export type NewProjectFolder = typeof projectFolders.$inferInsert
