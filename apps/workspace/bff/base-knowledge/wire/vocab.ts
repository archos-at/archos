/**
 * Every closed vocabulary of the base knowledge records (migrations 0202,
 * 0204, 0205 and 0208, ADR-0163, ADR-0165 and ADR-0166): the one source of each word. The SQL CHECKs are held to these lists
 * by `vocab.spec.ts`, which also writes `tests/fixtures/base-knowledge.schema.json`,
 * the copy the Python tier reads (its licence classes are tested against it).
 * Pure, so the UI reads them too.
 */

export const KNOWLEDGE_RECORD_TYPES = ['work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority', 'relation'] as const
export type KnowledgeRecordType = (typeof KNOWLEDGE_RECORD_TYPES)[number]

/**
 * Every kind of instrument (design §3.5, migration 0208): how far it binds is
 * its kind and its routes, never a flag on the record. Law binds in its
 * territory while in force; a model code, a standard or a guideline only where
 * a `makes_binding` route reaches it; a directive never binds a project
 * directly; a commentary never binds.
 */
export const KNOWLEDGE_WORK_KINDS = [
  'statute',
  'ordinance',
  'administrative_regulation',
  'directive',
  'intergovernmental_agreement',
  'model_code',
  'technical_standard',
  'guideline',
  'commentary',
  'authority_directive',
] as const
export type KnowledgeWorkKind = (typeof KNOWLEDGE_WORK_KINDS)[number]

/** The kinds an office holds a copy of (ADR-0163); the platform holds all of {@link KNOWLEDGE_WORK_KINDS}. */
export const OFFICE_WORK_KINDS = [
  'technical_standard',
  'guideline',
  'commentary',
  'authority_directive',
  'statute',
] as const satisfies readonly KnowledgeWorkKind[]
export type OfficeWorkKind = (typeof OFFICE_WORK_KINDS)[number]

/** How one instrument bears on another (design §3.5). */
export const RELATION_TYPES = ['makes_binding', 'supersedes', 'deviates_from', 'interprets'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

/** How a `makes_binding` reaches its target: declared, or a static or dynamic reference. */
export const BINDING_MODES = ['declared', 'static_reference', 'dynamic_reference'] as const
export type BindingMode = (typeof BINDING_MODES)[number]

/** What a relation's ends may be. */
export const RELATION_END_TYPES = ['work', 'edition'] as const
export type RelationEndType = (typeof RELATION_END_TYPES)[number]

/**
 * What an edition is to a project, computed from its route, never stored
 * (design §3.5): it binds; it guides (no route reaches it); it interprets; it
 * is an authority's practice; or it is information only.
 */
export const EDITION_ROLES = ['binding', 'guidance', 'interpretation', 'authority_practice', 'information'] as const
export type EditionRole = (typeof EDITION_ROLES)[number]

/** The licence classes the licensed seam keys on (design §3.4). */
export const LICENCE_CLASSES = ['public_open', 'public_restricted', 'licensed'] as const
export type LicenceClass = (typeof LICENCE_CLASSES)[number]

export const KNOWLEDGE_CHECK_RESULTS = ['current', 'newer_known', 'withdrawn', 'source_unreachable'] as const
export type KnowledgeCheckResult = (typeof KNOWLEDGE_CHECK_RESULTS)[number]

/** A copy's form: a text, a dataset, or a link to text held elsewhere. */
export const MANIFESTATION_FORMS = ['text', 'dataset', 'link'] as const
export type ManifestationForm = (typeof MANIFESTATION_FORMS)[number]

/** Whether a copy's text is the authentic one, an official text that does not prevail, or a translation. */
export const TEXT_STATUSES = ['authentic', 'official_non_prevailing', 'translation'] as const
export type TextStatus = (typeof TEXT_STATUSES)[number]

/** What a check targets: the platform checks editions, an office its own copies. */
export const CHECK_TARGET_TYPES = ['edition', 'manifestation'] as const
export type CheckTargetType = (typeof CHECK_TARGET_TYPES)[number]

/**
 * What a ruleset decides (design §3.7). The first four are decision tables
 * (`decision_table.v1`); the others are named now so the purpose list is one
 * list, and each gets its payload schema in the slice that first reads it
 * (setup facts, the advice policy, terminology).
 */
export const RULESET_PURPOSES = [
  'classification',
  'derivation',
  'reference_date',
  'competence',
  'fact_definitions',
  'fact_sources',
  'advice_policy',
  'terminology',
] as const
export type RulesetPurpose = (typeof RULESET_PURPOSES)[number]

export const DECISION_TABLE_PURPOSES = ['classification', 'derivation', 'reference_date', 'competence'] as const satisfies readonly RulesetPurpose[]

/** The payload schemas the evaluator reads. A v2 arrives with a pure converter from v1 (design §3.7). */
export const RULESET_PAYLOAD_SCHEMAS = ['decision_table.v1'] as const
export type RulesetPayloadSchema = (typeof RULESET_PAYLOAD_SCHEMAS)[number]

/** The types a decision table's input declares; a fact of another type is refused, never read as false. */
export const FACT_TYPES = ['number', 'boolean', 'code', 'codes', 'date'] as const
export type FactType = (typeof FACT_TYPES)[number]

/** The record types an office may own; territories and authorities are the platform's (migration 0205). An office relation is allowed by the SQL and has no writer yet. */
export const OFFICE_RECORD_TYPES = ['work', 'edition', 'manifestation', 'ruleset'] as const satisfies readonly KnowledgeRecordType[]

/** A territory's level (design §3.2); ids are ISO 3166 (`AT-6`) or `<CC>:<scheme>:<code>`. */
export const TERRITORY_KINDS = ['union', 'country', 'state', 'district', 'municipality', 'city_district'] as const
export type TerritoryKind = (typeof TERRITORY_KINDS)[number]

/** Where a platform change request stands (design §4.4). */
export const CHANGE_REQUEST_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'published', 'rolled_back'] as const
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number]

/** A reviewer's verdict on one claim. */
export const REVIEW_DECISIONS = ['accepted', 'edited', 'rejected'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

/** The role an approver approves in. */
export const APPROVAL_ROLES = ['domain_expert', 'counsel', 'second_reviewer'] as const
export type ApprovalRole = (typeof APPROVAL_ROLES)[number]

/** How a person said yes: in the app, or answering the door's elicitation. */
export const DECISION_SOURCES = ['app', 'elicitation'] as const
export type PersonDecisionSource = (typeof DECISION_SOURCES)[number]

/** A release channel: preview first, then stable, which moves the head offices read. */
export const RELEASE_CHANNELS = ['preview', 'stable'] as const
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number]

export const RELEASE_ACTIONS = ['publish', 'rollback'] as const
export type ReleaseAction = (typeof RELEASE_ACTIONS)[number]

/** An indexing run of a published platform text: enqueued, accepted by the corpus, or failed with why. */
export const INDEX_RUN_STATES = ['requested', 'queued', 'failed'] as const
export type IndexRunState = (typeof INDEX_RUN_STATES)[number]

/** Each vocabulary by the column its CHECK constrains: what the parity spec and the fixture walk. */
export const KNOWLEDGE_VOCABULARIES = {
  'knowledge_records.type': KNOWLEDGE_RECORD_TYPES,
  'knowledge_work_revisions.kind': KNOWLEDGE_WORK_KINDS,
  'knowledge_manifestation_revisions.form': MANIFESTATION_FORMS,
  'knowledge_manifestation_revisions.text_status': TEXT_STATUSES,
  'knowledge_manifestation_revisions.licence_class': LICENCE_CLASSES,
  'knowledge_checks.target_type': CHECK_TARGET_TYPES,
  'knowledge_checks.result': KNOWLEDGE_CHECK_RESULTS,
  'knowledge_ruleset_revisions.purpose': RULESET_PURPOSES,
  'knowledge_ruleset_revisions.payload_schema': RULESET_PAYLOAD_SCHEMAS,
  'knowledge_territory_revisions.kind': TERRITORY_KINDS,
  'knowledge_change_requests.status': CHANGE_REQUEST_STATUSES,
  'knowledge_review_decisions.decision': REVIEW_DECISIONS,
  'knowledge_approvals.role': APPROVAL_ROLES,
  'knowledge_approvals.decision_source': DECISION_SOURCES,
  'knowledge_release_moves.channel': RELEASE_CHANNELS,
  'knowledge_release_moves.action': RELEASE_ACTIONS,
  'knowledge_index_runs.state': INDEX_RUN_STATES,
  'knowledge_relation_revisions.relation_type': RELATION_TYPES,
  'knowledge_relation_revisions.mode': BINDING_MODES,
  'knowledge_relation_revisions.from_type': RELATION_END_TYPES,
  'knowledge_relation_revisions.to_type': RELATION_END_TYPES,
} as const satisfies Record<string, readonly string[]>
