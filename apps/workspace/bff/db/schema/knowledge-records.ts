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

export interface KnowledgeAddressee {
  name: string
  territoryId: string
  authorityId?: string
}

export interface KnowledgeIdentifiers {
  designation?: string
  [scheme: string]: string | undefined
}

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
  confirmedBy?: string
  note?: string
  citations?: { captureId?: string; quote?: string; url?: string; note?: string }[]
  proposal?: Record<string, unknown>
  viaClient?: string
  text?: KnowledgeTextProvenance
  imported?: { bundle: string; sha256?: string }
}

export type FetchSourceOrigin = 'built_in' | 'released' | 'draft'

export interface KnowledgeTextProvenance {
  origin: 'upload' | 'url'
  fileName: string
  sha256: string
  bytes: number
  pages: number | null
  sourceId?: string
  sourceOrigin?: FetchSourceOrigin
  sourceRevisionId?: string
  url?: string
  attachedBy: string
  attachedAt: string
}

export const knowledgeRecords = pgTable('knowledge_records', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  type: text('type').$type<KnowledgeRecordType>().notNull(),
  headRevisionId: uuid('head_revision_id'),
  documentId: uuid('document_id'),
  countryId: text('country_id'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  unlistedAt: timestamp('unlisted_at', { withTimezone: true }),
  unlistedHeadRevisionId: uuid('unlisted_head_revision_id'),
})

export const knowledgeRevisions = pgTable('knowledge_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  recordType: text('record_type').$type<KnowledgeRecordType>().notNull(),
  organizationId: text('organization_id'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  provenance: jsonb('provenance').$type<KnowledgeProvenance>().notNull().default({}),
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
  historyAvailableFrom: date('history_available_from'),
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
  transition: jsonb('transition').$type<Record<string, unknown> | null>(),
  appliesWhen: jsonb('applies_when').$type<Record<string, unknown> | null>(),
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
