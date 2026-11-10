/**
 * Base knowledge records (migration 0202, ADR-0163): one set of tables for the
 * platform (`organization_id` NULL) and every office. A work is the instrument
 * (ÖNORM B 1600), an edition its Ausgabe, a manifestation a held copy. Each is a
 * header row here and an append-only history of revisions with a typed body per
 * record type; `headRevisionId` names the revision in force.
 *
 * The SQL holds the invariants (owner-composite keys, append-only triggers,
 * cross-owner refusal, the layered RLS); this file only declares the columns the
 * repository reads and writes. `ownerKey` is generated and never written.
 */

import { date, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type {
  CheckTargetType,
  KnowledgeCheckResult,
  ManifestationForm,
  TextStatus,
  KnowledgeRecordType,
  KnowledgeWorkKind,
  LicenceClass,
} from '@/lib/base-knowledge/wire/vocab'

export {
  KNOWLEDGE_CHECK_RESULTS,
  KNOWLEDGE_RECORD_TYPES,
  KNOWLEDGE_WORK_KINDS,
  LICENCE_CLASSES,
  type KnowledgeCheckResult,
  type KnowledgeRecordType,
  type KnowledgeWorkKind,
  type LicenceClass,
} from '@/lib/base-knowledge/wire/vocab'

/** A directive's addressee: the authority by name and the territory it is competent for. */
export interface KnowledgeAddressee {
  name: string
  territoryId: string
  /** The platform's authority record it names (`authority:at-wien-ma37`), when one does (0203). */
  authorityId?: string
}

export interface KnowledgeIdentifiers {
  designation?: string
  [scheme: string]: string | undefined
}

/**
 * What the office's licence allows, with who stated it and when. Office-wide
 * use and processing by the hosted AI services are separate statements: a
 * licensed copy without the second stays metadata-only (design §4.7).
 */
export interface KnowledgeTerms {
  quoteMaxChars?: number
  validTo?: string
  attestedBy?: string
  attestedAt?: string
  aiProcessingAttestedBy?: string
  aiProcessingAttestedAt?: string
}

export interface KnowledgeProvenance {
  proposedBy?: 'reading' | 'person' | 'agent'
  note?: string
  /** Where a platform revision's values were taken from, for the reviewer (0203). */
  citations?: { url?: string; note?: string }[]
}

export const knowledgeRecords = pgTable('knowledge_records', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  type: text('type').$type<KnowledgeRecordType>().notNull(),
  headRevisionId: uuid('head_revision_id'),
  /** The office document the record was read from; deleting it deletes the record. */
  documentId: uuid('document_id'),
  /** The country a platform record belongs to (ISO 3166-1), what an office is entitled to; NULL for an office's (0203). */
  countryId: text('country_id'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const knowledgeRevisions = pgTable('knowledge_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  recordType: text('record_type').$type<KnowledgeRecordType>().notNull(),
  organizationId: text('organization_id'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  provenance: jsonb('provenance').$type<KnowledgeProvenance>().notNull().default({}),
  /** The change request a platform revision was proposed in; NULL for an office's (0203). */
  changeRequestId: uuid('change_request_id'),
})

export const knowledgeWorkRevisions = pgTable('knowledge_work_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  kind: text('kind').$type<KnowledgeWorkKind>().notNull(),
  title: text('title').notNull(),
  identifiers: jsonb('identifiers').$type<KnowledgeIdentifiers>().notNull().default({}),
  territoryIds: text('territory_ids').array().notNull().default([]),
  issuer: text('issuer'),
  addressees: jsonb('addressees').$type<KnowledgeAddressee[]>().notNull().default([]),
})

export const knowledgeEditionRevisions = pgTable('knowledge_edition_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  workId: text('work_id').notNull(),
  label: text('label').notNull(),
  issuedOn: date('issued_on'),
  inForceFrom: date('in_force_from'),
  inForceTo: date('in_force_to'),
  outline: jsonb('outline').$type<unknown[]>().notNull().default([]),
})

export const knowledgeManifestationRevisions = pgTable('knowledge_manifestation_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  editionId: text('edition_id').notNull(),
  form: text('form').$type<ManifestationForm>().notNull().default('text'),
  language: text('language').notNull().default('de'),
  textStatus: text('text_status').$type<TextStatus>().notNull().default('authentic'),
  licenceClass: text('licence_class').$type<LicenceClass>().notNull(),
  terms: jsonb('terms').$type<KnowledgeTerms>().notNull().default({}),
  sha256: text('sha256'),
  /** A platform text's file in the base corpus (0203); an office copy is its Archiv document instead. */
  corpusFile: text('corpus_file'),
})

export const knowledgeChecks = pgTable('knowledge_checks', {
  id: uuid('id').primaryKey(),
  organizationId: text('organization_id'),
  targetId: text('target_id').notNull(),
  targetType: text('target_type').$type<CheckTargetType>().notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  checkedBy: text('checked_by').notNull(),
  result: text('result').$type<KnowledgeCheckResult>().notNull(),
  note: text('note'),
})
