/**
 * Base knowledge records (migrations 0202 and 0204, ADR-0163 and ADR-0166): one set of tables for the
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
  ConnectingFactor,
  KnowledgeCheckResult,
  ManifestationForm,
  TextStatus,
  KnowledgeRecordType,
  KnowledgeWorkKind,
  LicenceClass,
  RulesetPayloadSchema,
  RulesetPurpose,
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
  /** The platform's authority record it names (`authority:at-wien-ma37`), when one does (0205). */
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
  /** Where a platform revision's values were taken from, for the reviewer (0205); a capture and its quote (0209). */
  citations?: { captureId?: string; quote?: string; url?: string; note?: string }[]
  /** The platform proposal as given, which `platform-knowledge-validate` re-runs the kit on (ADR-0170). */
  proposal?: Record<string, unknown>
  /** The OAuth client of the door call that proposed it; absent for a person in the app (ADR-0170). */
  viaClient?: string
}

export const knowledgeRecords = pgTable('knowledge_records', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  type: text('type').$type<KnowledgeRecordType>().notNull(),
  headRevisionId: uuid('head_revision_id'),
  /** The office document the record was read from; deleting it deletes the record. */
  documentId: uuid('document_id'),
  /** The country a platform record belongs to (ISO 3166-1), what an office is entitled to; NULL for an office's (0205). */
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
  /** The change request a platform revision was proposed in; NULL for an office's (0205). */
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
  /** The first day whose edition the platform holds (0206); before it an as-of answer is `history_not_held`. */
  historyAvailableFrom: date('history_available_from'),
  /** What the work attaches to (0212): the site, the office's seat, the client. Anything but `site` alone never binds by the site's chain. */
  connectsBy: text('connects_by').array().$type<ConnectingFactor[]>().notNull().default(['site']),
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
  /** An amending edition's transitional rule, a `decision_table.v1` giving old_law, new_law or choice (0206). */
  transition: jsonb('transition').$type<Record<string, unknown> | null>(),
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
  /** A platform text's file in the base corpus (0205); an office copy is its Archiv document instead. */
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

/**
 * A ruleset's body (migration 0204, ADR-0166): what it decides, where and when,
 * and its decision table or `inherits: 'parent'`. The payload is the wire's
 * `decisionTableSchema`, parsed again on every read: a row the evaluator cannot
 * read is refused, never half-run.
 */
export const knowledgeRulesetRevisions = pgTable('knowledge_ruleset_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  purpose: text('purpose').$type<RulesetPurpose>().notNull(),
  territoryIds: text('territory_ids').array().notNull(),
  workIds: text('work_ids').array().notNull().default([]),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  basisEditionId: text('basis_edition_id'),
  inherits: text('inherits').$type<'parent'>(),
  payloadSchema: text('payload_schema').$type<RulesetPayloadSchema>(),
  payload: jsonb('payload').$type<unknown>(),
})
