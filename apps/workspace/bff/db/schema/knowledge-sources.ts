/**
 * Public sources as platform records (migration 0212, ADR-0174): a source's
 * body, its write-only credential, and what its monitor saw last.
 *
 * All three are platform-private (RLS `false` for the runtime role). The body
 * is append-only like every revision body; the SQL holds the invariants (hosts
 * are exact names, one active credential per source, only a source holds one).
 */

import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { MonitorKind, PersonDecisionSource, SourceDataFlow, SourceFormat, SourceProtocol } from '@/lib/base-knowledge/wire/vocab'

export const knowledgeSourceRevisions = pgTable('knowledge_source_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  title: text('title').notNull(),
  territoryId: text('territory_id').notNull(),
  protocol: text('protocol').$type<SourceProtocol>().notNull(),
  format: text('format').$type<SourceFormat>().notNull(),
  hosts: text('hosts').array().notNull(),
  dataFlow: text('data_flow').$type<SourceDataFlow>().notNull(),
  monitorKind: text('monitor_kind').$type<MonitorKind>().notNull(),
  monitorIntervalHours: integer('monitor_interval_hours').notNull(),
  licence: text('licence').$type<'public_open' | 'public_restricted'>().notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
})

export const knowledgeSourceCredentials = pgTable('knowledge_source_credentials', {
  id: uuid('id').primaryKey(),
  recordId: text('record_id').notNull(),
  secretOwnerId: text('secret_owner_id').notNull(),
  secretBackend: text('secret_backend').$type<'workos-vault' | 'local-aes-gcm'>().notNull(),
  vaultObjectId: text('vault_object_id'),
  encryptedKey: text('encrypted_key'),
  keyHint: text('key_hint').notNull(),
  setBy: text('set_by').notNull(),
  decisionSource: text('decision_source').$type<PersonDecisionSource>().notNull(),
  setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
  replacedAt: timestamp('replaced_at', { withTimezone: true }),
})

export const knowledgeSourceMonitorStates = pgTable('knowledge_source_monitor_states', {
  recordId: text('record_id').primaryKey(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  okAt: timestamp('ok_at', { withTimezone: true }),
  failure: text('failure'),
  etag: text('etag'),
  sha256: text('sha256'),
  version: text('version'),
  termsSha256: text('terms_sha256'),
})
