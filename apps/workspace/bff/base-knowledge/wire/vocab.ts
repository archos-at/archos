/**
 * Every closed vocabulary of the base knowledge records (migrations 0202 and
 * 0203, ADR-0163 and ADR-0166): the one source of each word. The SQL CHECKs are held to these lists
 * by `vocab.spec.ts`, which also writes `tests/fixtures/base-knowledge.schema.json`,
 * the copy the Python tier reads (its licence classes are tested against it).
 * Pure, so the UI reads them too.
 */

export const KNOWLEDGE_RECORD_TYPES = ['work', 'edition', 'manifestation', 'ruleset'] as const
export type KnowledgeRecordType = (typeof KNOWLEDGE_RECORD_TYPES)[number]

/** The kinds an office can hold today (design §3.5); the platform widens the CHECK later. */
export const KNOWLEDGE_WORK_KINDS = [
  'technical_standard',
  'guideline',
  'commentary',
  'authority_directive',
  'statute',
] as const
export type KnowledgeWorkKind = (typeof KNOWLEDGE_WORK_KINDS)[number]

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
} as const satisfies Record<string, readonly string[]>
