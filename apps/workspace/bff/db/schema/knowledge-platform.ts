/**
 * The platform's side of the base knowledge records (migration 0205, ADR-0165):
 * the two record types only the platform owns (territories, authorities), the
 * change requests every platform revision is proposed in, the review verdicts
 * and approvals on them, the insert-only release moves that move a platform
 * head, the indexing runs of a published text, and the countries an office is
 * entitled to.
 *
 * The change-request tables are platform-private (RLS `false` for the runtime
 * role); `organizationCountries` is read by its office and written by the
 * platform only. The SQL holds the invariants (four eyes, head follows the
 * release, revisions only into a draft); this file only declares columns.
 */

import { bigint, boolean, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type {
  ApprovalRole,
  ChangeRequestApproval,
  ChangeRequestOrigin,
  CoverageLevel,
  ChangeRequestStatus,
  IndexRunState,
  PersonDecisionSource,
  ReleaseAction,
  ReleaseChannel,
  BindingMode,
  RelationEndType,
  RelationType,
  ReviewDecision,
  ReviewDecisionSource,
  SecondReviewDecision,
  SecondReviewState,
  TerritoryKind,
} from '@/lib/base-knowledge/wire/vocab'
import type { FetchSourceOrigin } from './knowledge-records'

/** A territory's parent (migration 0219, design §3.2): `AT` lies in `EU` from 1995-01-01. Half-open; an absent date is open. */
export interface TerritoryParent {
  id: string
  validFrom?: string | null
  validTo?: string | null
}

/** Paired clauses of a relation, AKN eIds (design §3.4): `{ from: 'par_4', to: 'pkt_3.1' }`. */
export interface RelationAnchor {
  from?: string
  to?: string
}

export const knowledgeTerritoryRevisions = pgTable('knowledge_territory_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  kind: text('kind').$type<TerritoryKind>().notNull(),
  name: text('name').notNull(),
  /** Every parent, nearest first, each for an interval when it states one (0219): the one field anything reads. */
  parents: jsonb('parents').$type<TerritoryParent[]>().notNull().default([]),
  /** Written beside `parents` for builds before 0219 only; drop with the contract migration. */
  parentIds: text('parent_ids').array().notNull().default([]),
  /** Written beside `parents` for builds before 0219 only; drop with the contract migration. */
  datedParents: jsonb('dated_parents').$type<TerritoryParent[]>().notNull().default([]),
  aliases: jsonb('aliases').$type<Record<string, string>>().notNull().default({}),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  /** How far the platform's records go in this node (0213, design §4.6); NULL inherits from the parent. */
  coverageLevel: text('coverage_level').$type<CoverageLevel>(),
  /** Whether the node's own municipal law is held (0213). */
  municipalLaw: boolean('municipal_law'),
  /** The IANA zone a day is read in at this node (0234); NULL inherits from the nearest parent that states one. */
  zone: text('zone'),
})

/** How one instrument bears on another (migration 0211, design §3.5). Append-only like every body. */
export const knowledgeRelationRevisions = pgTable('knowledge_relation_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  relationType: text('relation_type').$type<RelationType>().notNull(),
  mode: text('mode').$type<BindingMode>(),
  fromId: text('from_id').notNull(),
  fromType: text('from_type').$type<RelationEndType>().notNull(),
  toId: text('to_id').notNull(),
  toType: text('to_type').$type<RelationEndType>().notNull(),
  anchors: jsonb('anchors').$type<RelationAnchor[]>().notNull().default([]),
  provision: text('provision'),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
})

export const knowledgeAuthorityRevisions = pgTable('knowledge_authority_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  name: text('name').notNull(),
  functionCodes: text('function_codes').array().notNull().default([]),
  seatTerritoryId: text('seat_territory_id').notNull(),
  competenceTerritoryIds: text('competence_territory_ids').array().notNull(),
  identifiers: jsonb('identifiers').$type<Record<string, string>>().notNull().default({}),
})

export const knowledgeChangeRequests = pgTable('knowledge_change_requests', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  countryId: text('country_id').notNull(),
  status: text('status').$type<ChangeRequestStatus>().notNull().default('draft'),
  baseReleaseSeq: bigint('base_release_seq', { mode: 'number' }).notNull().default(0),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  /** An operator's, or a source monitor's (migration 0212, ADR-0174). */
  origin: text('origin').$type<ChangeRequestOrigin>().notNull().default('operator'),
  sourceRecordId: text('source_record_id'),
  monitorFinding: jsonb('monitor_finding').$type<Record<string, unknown>>(),
  /** `single`: approved by its author through an override; a second review is owed (migration 0214, ADR-0176). */
  approval: text('approval').$type<ChangeRequestApproval>().notNull().default('four_eyes'),
  /** NULL on a four-eyes request; `due` until another person confirms or disputes a single approval. */
  secondReview: text('second_review').$type<SecondReviewState>(),
  secondReviewBy: text('second_review_by'),
  secondReviewAt: timestamp('second_review_at', { withTimezone: true }),
})

export const knowledgeReviewDecisions = pgTable('knowledge_review_decisions', {
  id: uuid('id').primaryKey(),
  changeRequestId: uuid('change_request_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  claimPath: text('claim_path').notNull(),
  decision: text('decision').$type<ReviewDecision>().notNull(),
  note: text('note'),
  reviewer: text('reviewer').notNull(),
  /** NULL only on verdicts written before migration 0208. */
  decisionSource: text('decision_source').$type<ReviewDecisionSource>(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  /** The reviewer checked the cited capture against its source (0209); required for an operator-supplied one. */
  sourceChecked: boolean('source_checked').notNull().default(false),
})

/** A page as the product captured it for a citation (0209, ADR-0170): what KC-6 checks a quote against. */
export const knowledgeCitationCaptures = pgTable('knowledge_citation_captures', {
  id: uuid('id').primaryKey(),
  changeRequestId: uuid('change_request_id').notNull(),
  basis: text('basis').$type<'fetched' | 'operator_supplied'>().notNull(),
  sourceId: text('source_id'),
  /** What the fetch went through, recorded at fetch time (0224): only a built-in or a reviewed released source counts as fetched. */
  sourceOrigin: text('source_origin').$type<FetchSourceOrigin>(),
  /** The source record's revision the fetch used: its released head, or the draft under test. */
  sourceRevisionId: uuid('source_revision_id'),
  url: text('url').notNull(),
  finalUrl: text('final_url'),
  contentType: text('content_type'),
  sha256: text('sha256').notNull(),
  byteSize: integer('byte_size').notNull(),
  text: text('text'),
  note: text('note'),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
  createdBy: text('created_by').notNull(),
  viaClient: text('via_client'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const knowledgeApprovals = pgTable('knowledge_approvals', {
  id: uuid('id').primaryKey(),
  changeRequestId: uuid('change_request_id').notNull(),
  approver: text('approver').notNull(),
  role: text('role').$type<ApprovalRole>().notNull(),
  decisionSource: text('decision_source').$type<PersonDecisionSource>().notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  /** Set only on an author's own approval through the override (migration 0214): why no second person approved. */
  overrideReason: text('override_reason'),
})

/** One role's second review of a request approved alone (migration 0214, ADR-0176): append-only, once per role. */
export const knowledgeSecondReviews = pgTable('knowledge_second_reviews', {
  id: uuid('id').primaryKey(),
  changeRequestId: uuid('change_request_id').notNull(),
  role: text('role').$type<ApprovalRole>().notNull(),
  decision: text('decision').$type<SecondReviewDecision>().notNull(),
  reviewer: text('reviewer').notNull(),
  decisionSource: text('decision_source').$type<PersonDecisionSource>().notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
})

export const knowledgeReleaseMoves = pgTable('knowledge_release_moves', {
  seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  recordId: text('record_id').notNull(),
  channel: text('channel').$type<ReleaseChannel>().notNull(),
  action: text('action').$type<ReleaseAction>().notNull(),
  fromRevisionId: uuid('from_revision_id'),
  toRevisionId: uuid('to_revision_id'),
  changeRequestId: uuid('change_request_id').notNull(),
  releasedBy: text('released_by').notNull(),
  decisionSource: text('decision_source').$type<PersonDecisionSource>().notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason'),
})

export const knowledgeIndexRuns = pgTable('knowledge_index_runs', {
  id: uuid('id').primaryKey(),
  revisionId: uuid('revision_id').notNull(),
  corpusFile: text('corpus_file').notNull(),
  changeRequestId: uuid('change_request_id').notNull(),
  state: text('state').$type<IndexRunState>().notNull().default('requested'),
  failure: text('failure'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizationCountries = pgTable(
  'organization_countries',
  {
    organizationId: text('organization_id').notNull(),
    countryId: text('country_id').notNull(),
    entitledBy: text('entitled_by').notNull(),
    decisionSource: text('decision_source').$type<PersonDecisionSource>().notNull(),
    entitledAt: timestamp('entitled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: 'organization_countries_pkey', columns: [table.organizationId, table.countryId] })]
)
