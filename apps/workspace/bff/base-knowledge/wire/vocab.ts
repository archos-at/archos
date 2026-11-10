/**
 * Every closed vocabulary of the base knowledge records (migrations 0202,
 * 0204, 0205 and 0209, ADR-0163, ADR-0165 and ADR-0166): the one source of each word. The SQL CHECKs are held to these lists
 * by `vocab.spec.ts`, which also writes `tests/fixtures/base-knowledge.schema.json`,
 * the copy the Python tier reads (its licence classes are tested against it).
 * Pure, so the UI reads them too. A source's protocols and formats are not
 * here: Python's registry is their one list (`SOURCE_PROTOCOLS`,
 * `SOURCE_FORMATS` in `shared/vocabularies.generated.ts`, read by
 * `./source.ts`), and no CHECK holds them. This module imports nothing, so a
 * change to it reaches only its own importers (`scripts/blast-radius.mjs`).
 */

export const KNOWLEDGE_RECORD_TYPES = ['work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority', 'relation', 'source'] as const
export type KnowledgeRecordType = (typeof KNOWLEDGE_RECORD_TYPES)[number]

/**
 * Every kind of instrument (design §3.5, migration 0211): how far it binds is
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

/**
 * The payload schemas a ruleset body may carry: the evaluator's decision table,
 * the two setup records (migration 0207, ADR-0169), and the advice policy and
 * terminology (ADR-0174). A v2 arrives with a pure converter from v1 (design §3.7).
 */
export const RULESET_PAYLOAD_SCHEMAS = [
  'decision_table.v1',
  'fact_definitions.v1',
  'fact_sources.v1',
  'advice_policy.v1',
  'terminology.v1',
] as const
export type RulesetPayloadSchema = (typeof RULESET_PAYLOAD_SCHEMAS)[number]

/** The purpose each setup record schema serves: one each, held by a CHECK as well. */
export const SETUP_RECORD_PURPOSES = {
  'fact_definitions.v1': 'fact_definitions',
  'fact_sources.v1': 'fact_sources',
} as const satisfies Partial<Record<RulesetPayloadSchema, RulesetPurpose>>

/** The purpose every schema but the decision table serves: one each (migrations 0207 and 0212 hold the pairing). */
export const RECORD_SCHEMA_PURPOSES = {
  ...SETUP_RECORD_PURPOSES,
  'advice_policy.v1': 'advice_policy',
  'terminology.v1': 'terminology',
} as const satisfies Partial<Record<RulesetPayloadSchema, RulesetPurpose>>

/**
 * What an answer may do on one topic of legal advice (design §9b(b), ADR-0174),
 * strictest last: `assert` states a provision and applies it to the stated facts,
 * `hedge` says the matter needs an individual assessment, `decline` does not
 * answer it and says who does. Composed by depth, the strictest wins, and an
 * office may only tighten.
 */
export const ADVICE_MODES = ['assert', 'hedge', 'decline'] as const
export type AdviceMode = (typeof ADVICE_MODES)[number]

/**
 * The topics an advice policy speaks to. Each is a fixed hedge template per mode
 * (`rulesets/advice.ts`), so a policy is codes and never prose a prompt reads.
 */
export const ADVICE_TOPICS = [
  'provision_application',
  'individual_assessment',
  'deadlines',
  'authority_discretion',
  'contract_drafting',
  'representation',
] as const
export type AdviceTopic = (typeof ADVICE_TOPICS)[number]

/**
 * What the location decides about a project, by ticket 31's table
 * „Standortinformationen aus den Unterlagen": the plot (Grundbuch), zoning and
 * Bebauungsbestimmungen, heritage, natural hazards and contamination, and
 * noise. A `fact_sources` entry with one of these is listed by the setup's
 * register on its own.
 */
export const SETUP_DETERMINANTS = ['plot', 'zoning', 'heritage', 'hazards', 'noise'] as const
export type SetupDeterminant = (typeof SETUP_DETERMINANTS)[number]

/** The types a decision table's input declares; a fact of another type is refused, never read as false. */
export const FACT_TYPES = ['number', 'boolean', 'code', 'codes', 'date'] as const
export type FactType = (typeof FACT_TYPES)[number]

/** The record types an office may own; territories and authorities are the platform's (migration 0205). An office relation is allowed by the SQL and has no writer yet. */
export const OFFICE_RECORD_TYPES = ['work', 'edition', 'manifestation', 'ruleset'] as const satisfies readonly KnowledgeRecordType[]

/** A territory's level (design §3.2); ids are ISO 3166 (`AT-6`) or `<CC>:<scheme>:<code>`. */
export const TERRITORY_KINDS = ['union', 'country', 'state', 'district', 'municipality', 'city_district'] as const
export type TerritoryKind = (typeof TERRITORY_KINDS)[number]

/**
 * How far the platform's records go in a territory (design §4.6, migration
 * 0213): `none` holds territories only, `open` live official sources nobody
 * curated, `core` reviewed codes and the relations that make them binding,
 * `full` competence, classification, Stichtag rules and fact sources too.
 * Ordered weakest first: a site's gate is its weakest leaf.
 */
export const COVERAGE_LEVELS = ['none', 'open', 'core', 'full'] as const

/**
 * What the turn may claim about the law of its site, weakest first after the
 * three refusals:
 *
 * - `organization_unplaced`: the office has no home country; nothing territorial answers (E47).
 * - `site_unknown`: no site and no place the turn named; the answer asks for the place (E04).
 * - `not_entitled`: the site's country is not entitled; documents and office copies still answer (E01).
 * - `knowledge_unavailable`: the records could not be read; retrieval, law lookup and classification are withheld.
 * - a coverage level: how far the platform's records go at the weakest leaf (design §4.6).
 */
export const GATE_STATES = ['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', ...COVERAGE_LEVELS] as const
export type GateState = (typeof GATE_STATES)[number]

/** Why a site is unknown: no site was stated, or a point lies in no territory the records hold. */
export const SITE_UNKNOWN_REASONS = ['no_site', 'no_territory'] as const

/**
 * The schemes a work's identifiers are read in, so a passage the agent reads
 * live at its source finds its work (ADR-0175): RIS's Gesetzesnummer (the
 * `Gesetzesnummer` query parameter of a consolidated text) and an ELI (the
 * work's URL, matched by whole path segments). A scheme added here is matched
 * by the agent only once it learns it (`citations/roles.py`).
 */
export const SOURCE_REF_SCHEMES = ['ris_gesetzesnummer', 'eli'] as const
export type SourceRefScheme = (typeof SOURCE_REF_SCHEMES)[number]
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number]

/**
 * What a work attaches to (migration 0213, design §3.1): the site, the office's
 * seat (HOAI), or the client (VgV for a public one). A work that attaches to
 * anything but the site is never binding by the site's chain alone (E40).
 */
export const CONNECTING_FACTORS = ['site', 'office_seat', 'client'] as const
export type ConnectingFactor = (typeof CONNECTING_FACTORS)[number]

/** Where a platform change request stands (design §4.4). */
export const CHANGE_REQUEST_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'published', 'rolled_back'] as const
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number]

/** A reviewer's verdict on one claim. */
export const REVIEW_DECISIONS = ['accepted', 'edited', 'rejected'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

/** How a change request was approved: by a second person, or by its author alone through the override (ADR-0176). */
export const CHANGE_REQUEST_APPROVALS = ['four_eyes', 'single'] as const
export type ChangeRequestApproval = (typeof CHANGE_REQUEST_APPROVALS)[number]

/**
 * The review a single approval owes (ADR-0176): due until another person confirms every role approved alone or
 * disputes one; void when the request was rejected before it was approved, so nothing of it reached an office.
 */
export const SECOND_REVIEW_STATES = ['due', 'confirmed', 'disputed', 'void'] as const
export type SecondReviewState = (typeof SECOND_REVIEW_STATES)[number]

/** One role's second review: confirmed, or disputed (ADR-0176). */
export const SECOND_REVIEW_DECISIONS = ['confirmed', 'disputed'] as const
export type SecondReviewDecision = (typeof SECOND_REVIEW_DECISIONS)[number]

/** The role an approver approves in. */
export const APPROVAL_ROLES = ['domain_expert', 'counsel', 'privacy_reviewer'] as const
export type ApprovalRole = (typeof APPROVAL_ROLES)[number]

/** How a person said yes: in the app, or answering the door's elicitation. */
export const DECISION_SOURCES = ['app', 'elicitation'] as const
export type PersonDecisionSource = (typeof DECISION_SOURCES)[number]

/** How a verdict on a claim was given: the person's own yes, or an agent's call the person did not confirm. */
export const REVIEW_DECISION_SOURCES = [...DECISION_SOURCES, 'agent'] as const
export type ReviewDecisionSource = (typeof REVIEW_DECISION_SOURCES)[number]

/** A release channel: preview first, then stable, which moves the head offices read. */
export const RELEASE_CHANNELS = ['preview', 'stable'] as const
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number]

export const RELEASE_ACTIONS = ['publish', 'rollback'] as const
export type ReleaseAction = (typeof RELEASE_ACTIONS)[number]

/** An indexing run of a published platform text: enqueued, accepted by the corpus, or failed with why. */
export const INDEX_RUN_STATES = ['requested', 'queued', 'failed'] as const
export type IndexRunState = (typeof INDEX_RUN_STATES)[number]

/** Where a change request came from: an operator (or their agent), or a source monitor that found a change (ADR-0174). */
export const CHANGE_REQUEST_ORIGINS = ['operator', 'monitor'] as const
export type ChangeRequestOrigin = (typeof CHANGE_REQUEST_ORIGINS)[number]

/** What may leave towards a source: nothing about a tenant, or a site point too (privacy review, design §6.4). */
export const SOURCE_DATA_FLOWS = ['public_only', 'site_keyed'] as const
export type SourceDataFlow = (typeof SOURCE_DATA_FLOWS)[number]

/** How a source's monitor notices a change; `none` is a source nobody watches. Deterministic, no model call. */
export const MONITOR_KINDS = ['none', 'sha256', 'etag', 'version'] as const
export type MonitorKind = (typeof MONITOR_KINDS)[number]

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
  'knowledge_territory_revisions.coverage_level': COVERAGE_LEVELS,
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
  'knowledge_change_requests.origin': CHANGE_REQUEST_ORIGINS,
  'knowledge_change_requests.approval': CHANGE_REQUEST_APPROVALS,
  'knowledge_change_requests.second_review': SECOND_REVIEW_STATES,
  'knowledge_second_reviews.role': APPROVAL_ROLES,
  'knowledge_second_reviews.decision': SECOND_REVIEW_DECISIONS,
  'knowledge_second_reviews.decision_source': DECISION_SOURCES,
  'knowledge_source_revisions.data_flow': SOURCE_DATA_FLOWS,
  'knowledge_source_revisions.monitor_kind': MONITOR_KINDS,
} as const satisfies Record<string, readonly string[]>
