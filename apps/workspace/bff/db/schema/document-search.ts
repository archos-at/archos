import { boolean, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { documents } from './documents'
import { projects } from './projects'

export interface SearchFacetParty {
  role: string
  name: string
}

export interface SearchFacetFact {
  key: string
  value: string
  unit: string | null
  page: number | null
}

export interface SearchFacetChange {
  key: string
  before: string | null
  after: string | null
  page: number | null
}

export const documentSearchFacets = pgTable('document_search_facets', {
  documentId: uuid('document_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull(),
  documentType: text('document_type'),
  tags: text('tags').array().notNull().default([]),
  topics: text('topics').array().notNull().default([]),
  title: text('title'),
  summary: text('summary'),
  parties: jsonb('parties').$type<SearchFacetParty[]>().notNull().default([]),
  partyRoles: text('party_roles').array().notNull().default([]),
  address: text('address'),
  municipality: text('municipality'),
  federalState: text('federal_state'),
  facts: jsonb('facts').$type<SearchFacetFact[]>().notNull().default([]),
  factTokens: text('fact_tokens').array().notNull().default([]),
  factNumbers: jsonb('fact_numbers').$type<Record<string, number>>().notNull().default({}),
  referenceTokens: text('reference_tokens').array().notNull().default([]),
  referenceLabels: jsonb('reference_labels').$type<Record<string, string>>().notNull().default({}),
  planNumber: text('plan_number'),
  planNumberKey: text('plan_number_key'),
  planIndex: text('plan_index'),
  planDate: date('plan_date'),
  scale: text('scale'),
  documentDate: date('document_date'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  camera: text('camera'),
  pageCount: integer('page_count'),
  pagesNotRead: integer('pages_not_read'),
  superseded: boolean('superseded').notNull().default(false),
  changedFacts: jsonb('changed_facts').$type<SearchFacetChange[]>().notNull().default([]),
  changedFactKeys: text('changed_fact_keys').array().notNull().default([]),
  searchText: text('search_text').notNull().default(''),
  fingerprint: text('fingerprint').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
})

export type DocumentSearchFacetsRow = typeof documentSearchFacets.$inferSelect
export type NewDocumentSearchFacetsRow = typeof documentSearchFacets.$inferInsert

export const documentSearchShelves = pgTable(
  'document_search_shelves',
  {
    organizationId: text('organization_id').notNull(),
    shelfKey: text('shelf_key').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    sourceFingerprint: text('source_fingerprint'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    refreshRequestedAt: timestamp('refresh_requested_at', { withTimezone: true }),
  },
  (table) => ({ pk: primaryKey({ columns: [table.organizationId, table.shelfKey] }) })
)

export type DocumentSearchShelfRow = typeof documentSearchShelves.$inferSelect
