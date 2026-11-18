export const KNOWLEDGE_RECORD_TYPES = ['work', 'edition', 'manifestation', 'ruleset', 'territory', 'authority', 'relation', 'source', 'golden_case'] as const
export type KnowledgeRecordType = (typeof KNOWLEDGE_RECORD_TYPES)[number]

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

export const OFFICE_WORK_KINDS = [
  'technical_standard',
  'guideline',
  'commentary',
  'authority_directive',
  'statute',
] as const satisfies readonly KnowledgeWorkKind[]
export type OfficeWorkKind = (typeof OFFICE_WORK_KINDS)[number]

export const RELATION_TYPES = ['makes_binding', 'supersedes', 'deviates_from', 'interprets'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export const BINDING_MODES = ['declared', 'static_reference', 'dynamic_reference'] as const
export type BindingMode = (typeof BINDING_MODES)[number]

export const RELATION_END_TYPES = ['work', 'edition'] as const
export type RelationEndType = (typeof RELATION_END_TYPES)[number]

export const EDITION_ROLES = ['binding', 'guidance', 'interpretation', 'authority_practice', 'information'] as const
export type EditionRole = (typeof EDITION_ROLES)[number]

export const LICENCE_CLASSES = ['public_open', 'public_restricted', 'licensed'] as const
export type LicenceClass = (typeof LICENCE_CLASSES)[number]

export const KNOWLEDGE_CHECK_RESULTS = ['current', 'newer_known', 'withdrawn', 'source_unreachable'] as const
export type KnowledgeCheckResult = (typeof KNOWLEDGE_CHECK_RESULTS)[number]

export const MANIFESTATION_FORMS = ['text', 'dataset', 'link'] as const
export type ManifestationForm = (typeof MANIFESTATION_FORMS)[number]

export const TEXT_STATUSES = ['authentic', 'official_non_prevailing', 'translation'] as const
export type TextStatus = (typeof TEXT_STATUSES)[number]

export const CHECK_TARGET_TYPES = ['edition', 'manifestation'] as const
export type CheckTargetType = (typeof CHECK_TARGET_TYPES)[number]

export const RULESET_PURPOSES = [
  'classification',
  'derivation',
  'reference_date',
  'competence',
  'fact_definitions',
  'fact_sources',
  'advice_policy',
  'terminology',
  'citation_style',
] as const
export type RulesetPurpose = (typeof RULESET_PURPOSES)[number]

export const DECISION_TABLE_PURPOSES = ['classification', 'derivation', 'reference_date', 'competence'] as const satisfies readonly RulesetPurpose[]

export const RULESET_PAYLOAD_SCHEMAS = [
  'decision_table.v1',
  'fact_definitions.v1',
  'fact_sources.v1',
  'advice_policy.v1',
  'terminology.v1',
  'citation_style.v1',
] as const
export type RulesetPayloadSchema = (typeof RULESET_PAYLOAD_SCHEMAS)[number]

export const SETUP_RECORD_PURPOSES = {
  'fact_definitions.v1': 'fact_definitions',
  'fact_sources.v1': 'fact_sources',
} as const satisfies Partial<Record<RulesetPayloadSchema, RulesetPurpose>>

export const RECORD_SCHEMA_PURPOSES = {
  ...SETUP_RECORD_PURPOSES,
  'advice_policy.v1': 'advice_policy',
  'terminology.v1': 'terminology',
  'citation_style.v1': 'citation_style',
} as const satisfies Partial<Record<RulesetPayloadSchema, RulesetPurpose>>

export const ADVICE_MODES = ['assert', 'hedge', 'decline'] as const
export type AdviceMode = (typeof ADVICE_MODES)[number]

export const ADVICE_TOPICS = [
  'provision_application',
  'individual_assessment',
  'deadlines',
  'authority_discretion',
  'contract_drafting',
  'representation',
] as const
export type AdviceTopic = (typeof ADVICE_TOPICS)[number]

export const SETUP_DETERMINANTS = ['plot', 'zoning', 'heritage', 'hazards', 'noise'] as const
export type SetupDeterminant = (typeof SETUP_DETERMINANTS)[number]

export const FACT_TYPES = ['number', 'boolean', 'code', 'codes', 'date'] as const
export type FactType = (typeof FACT_TYPES)[number]

export const OFFICE_RECORD_TYPES = ['work', 'edition', 'manifestation', 'ruleset'] as const satisfies readonly KnowledgeRecordType[]

export const TERRITORY_KINDS = ['union', 'country', 'state', 'district', 'municipality', 'city_district'] as const
export type TerritoryKind = (typeof TERRITORY_KINDS)[number]

export const COVERAGE_LEVELS = ['none', 'open', 'core', 'full'] as const

export const GATE_STATES = ['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', ...COVERAGE_LEVELS] as const
export type GateState = (typeof GATE_STATES)[number]

export const SITE_UNKNOWN_REASONS = ['no_site', 'no_territory'] as const

export const APPLICABILITY_VERDICTS = ['applies', 'check', 'not_applicable'] as const
export type ApplicabilityVerdict = (typeof APPLICABILITY_VERDICTS)[number]
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number]

export const CONNECTING_FACTORS = ['site', 'office_seat', 'client'] as const
export type ConnectingFactor = (typeof CONNECTING_FACTORS)[number]

export const CHANGE_REQUEST_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'published', 'rolled_back'] as const
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number]

export const REVIEW_DECISIONS = ['accepted', 'edited', 'rejected'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

export const CHANGE_REQUEST_APPROVALS = ['four_eyes', 'single'] as const
export type ChangeRequestApproval = (typeof CHANGE_REQUEST_APPROVALS)[number]

export const SECOND_REVIEW_STATES = ['due', 'confirmed', 'disputed', 'void'] as const
export type SecondReviewState = (typeof SECOND_REVIEW_STATES)[number]

export const SECOND_REVIEW_DECISIONS = ['confirmed', 'disputed'] as const
export type SecondReviewDecision = (typeof SECOND_REVIEW_DECISIONS)[number]

export const APPROVAL_ROLES = ['domain_expert', 'counsel', 'privacy_reviewer'] as const
export type ApprovalRole = (typeof APPROVAL_ROLES)[number]

export const DECISION_SOURCES = ['app', 'elicitation'] as const
export type PersonDecisionSource = (typeof DECISION_SOURCES)[number]

export const REVIEW_DECISION_SOURCES = [...DECISION_SOURCES, 'agent', 'carried'] as const
export type ReviewDecisionSource = (typeof REVIEW_DECISION_SOURCES)[number]

export const RELEASE_DECISION_SOURCES = [...DECISION_SOURCES, 'carried'] as const
export type ReleaseDecisionSource = (typeof RELEASE_DECISION_SOURCES)[number]

export const RELEASE_CHANNELS = ['preview', 'stable'] as const
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number]

export const RELEASE_ACTIONS = ['publish', 'rollback'] as const
export type ReleaseAction = (typeof RELEASE_ACTIONS)[number]

export const INDEX_RUN_STATES = ['requested', 'queued', 'failed'] as const
export type IndexRunState = (typeof INDEX_RUN_STATES)[number]

export const CHANGE_REQUEST_ORIGINS = ['operator', 'monitor'] as const
export type ChangeRequestOrigin = (typeof CHANGE_REQUEST_ORIGINS)[number]

export const SOURCE_DATA_FLOWS = ['public_only', 'site_keyed'] as const
export type SourceDataFlow = (typeof SOURCE_DATA_FLOWS)[number]

export const MONITOR_KINDS = ['none', 'sha256', 'etag', 'version'] as const
export type MonitorKind = (typeof MONITOR_KINDS)[number]

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
  'knowledge_approvals.decision_source': RELEASE_DECISION_SOURCES,
  'knowledge_release_moves.channel': RELEASE_CHANNELS,
  'knowledge_release_moves.action': RELEASE_ACTIONS,
  'knowledge_release_moves.decision_source': RELEASE_DECISION_SOURCES,
  'knowledge_review_decisions.decision_source': REVIEW_DECISION_SOURCES,
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
