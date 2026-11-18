import { sql } from 'drizzle-orm'
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import type { FolderCardKeyFact } from '@/lib/folder-cards/types'
import { projectFolders } from './project-folders'

export const folderCards = pgTable(
  'folder_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    folderId: uuid('folder_id').notNull(),
    scope: text('scope', { enum: ['project', 'office_shelf'] }).notNull(),
    collection: text('collection').notNull(),
    abstract: text('abstract'),
    keyFacts: jsonb('key_facts').$type<FolderCardKeyFact[]>().notNull().default(sql`'[]'::jsonb`),
    inputHash: text('input_hash').notNull(),
    abstractHash: text('abstract_hash'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    status: text('status', { enum: ['fresh', 'stale', 'failed'] }).notNull().default('stale'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    folderKey: unique('folder_cards_folder_key').on(table.folderId),
    folderFk: foreignKey({
      name: 'folder_cards_folder_fkey',
      columns: [table.folderId, table.organizationId, table.scope],
      foreignColumns: [projectFolders.id, projectFolders.organizationId, projectFolders.scope],
    }).onDelete('cascade'),
    collectionIdx: index('idx_folder_cards_collection').on(table.organizationId, table.collection),
    scopeCheck: check('folder_cards_scope_check', sql`${table.scope} IN ('project', 'office_shelf')`),
    abstractLength: check(
      'folder_cards_abstract_length',
      sql`${table.abstract} IS NULL OR char_length(${table.abstract}) <= 600`,
    ),
    keyFactsShape: check(
      'folder_cards_key_facts_shape',
      sql`jsonb_typeof(${table.keyFacts}) = 'array' AND jsonb_array_length(${table.keyFacts}) <= 8`,
    ),
    statusCheck: check('folder_cards_status_check', sql`${table.status} IN ('fresh', 'stale', 'failed')`),
  }),
)

export type FolderCardRow = typeof folderCards.$inferSelect
