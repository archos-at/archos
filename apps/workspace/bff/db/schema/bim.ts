import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  bigserial,
  check,
  index,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { projects } from './projects'
import { documents } from './documents'
import type {
  BimClassification,
  BimModelStatus,
  BimModelSummary,
  BimPropertySets,
  BimQuantitySets,
} from '@/lib/bim/types'
import { BIM_MODEL_STATUSES } from '@/lib/bim/types'
import type { StoredRuleInputs } from '@/lib/bim/rule-inputs'

export const bimModels = pgTable(
  'bim_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    status: text('status').$type<BimModelStatus>().notNull().default('pending'),
    schemaVersion: text('schema_version'),
    indexStorageKey: text('index_storage_key'),
    indexStorageBucket: text('index_storage_bucket'),
    summary: jsonb('summary').$type<BimModelSummary>(),
    elementCount: integer('element_count').notNull().default(0),
    ruleInputs: jsonb('rule_inputs').$type<StoredRuleInputs>(),
    searchKeysIndexed: boolean('search_keys_indexed').notNull().default(false),
    runId: uuid('run_id'),
    errorMessage: text('error_message'),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentIdx: uniqueIndex('bim_models_document_idx').on(table.documentId),
    projectIdx: index('bim_models_project_idx').on(table.projectId),
    orgStatusIdx: index('bim_models_org_status_idx').on(table.organizationId, table.status),
    statusKnown: check(
      'bim_models_status_known',
      sql`${table.status} IN (${sql.raw(BIM_MODEL_STATUSES.map((status) => `'${status}'`).join(', '))})`
    ),
  })
)

export const bimElements = pgTable(
  'bim_elements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => bimModels.id, { onDelete: 'cascade' }),
    globalId: text('global_id').notNull(),
    expressId: integer('express_id').notNull(),
    ifcType: text('ifc_type').notNull(),
    name: text('name'),
    predefinedType: text('predefined_type'),
    objectType: text('object_type'),
    tag: text('tag'),
    typeName: text('type_name'),
    storeyGlobalId: text('storey_global_id'),
    storeyName: text('storey_name'),
    containerKind: text('container_kind'),
    containerName: text('container_name'),
    materials: jsonb('materials').$type<string[]>().notNull().default([]),
    classifications: jsonb('classifications').$type<BimClassification[]>().notNull().default([]),
    properties: jsonb('properties').$type<BimPropertySets>().notNull().default({}),
    quantities: jsonb('quantities').$type<BimQuantitySets>().notNull().default({}),
    searchKeys: jsonb('search_keys').$type<Record<string, string[]>>(),
  },
  (table) => ({
    modelExpressIdx: uniqueIndex('bim_elements_model_express_idx').on(
      table.modelId,
      table.expressId
    ),
    modelTypeIdx: index('bim_elements_model_type_express_idx').on(
      table.modelId,
      table.ifcType,
      table.expressId
    ),
    modelStoreyIdx: index('bim_elements_model_storey_lower_idx').on(
      table.modelId,
      sql`lower(${table.storeyName})`
    ),
    globalIdIdx: index('bim_elements_global_id_idx').on(table.modelId, table.globalId),
    searchKeysIdx: index('bim_elements_search_keys_idx').using('gin', table.searchKeys),
  })
)

export type BimModelRow = typeof bimModels.$inferSelect
export type NewBimModelRow = typeof bimModels.$inferInsert
export type BimElementRow = typeof bimElements.$inferSelect
export type NewBimElementRow = typeof bimElements.$inferInsert

export const bimCheckConfirmations = pgTable(
  'bim_check_confirmations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    ruleId: text('rule_id').notNull(),
    modelId: uuid('model_id').notNull(),
    confirmedBy: text('confirmed_by').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bim_check_confirmations_unique').on(
      table.organizationId,
      table.projectId,
      table.ruleId,
      table.modelId
    ),
    index('bim_check_confirmations_project_idx').on(table.organizationId, table.projectId),
  ]
)
