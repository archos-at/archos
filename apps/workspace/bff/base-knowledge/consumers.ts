/**
 * The element ledger of the base knowledge records (design §3.10, ADR-0158):
 * every column, search-index payload field and behaviour-bearing enum value,
 * with the file that reads it and a deterministic test (no model call) that
 * proves the reading. `knowledge-consumers.spec.ts` fails when an element has
 * no entry, when an entry's consumer no longer names it, or when its test is
 * gone. A column written before anything reads it says which later part reads
 * it (`awaits`); that list may only shrink.
 *
 * Each later part adds its consumers here, so the record model cannot relapse
 * into fields nobody reads (the fate of ADR-0025's first version).
 *
 * Paths are relative to the repository root.
 */

export interface ConsumerTest {
  file: string
  name: string
}

export type KnowledgeConsumer =
  | { element: string; consumer: string; test: ConsumerTest }
  | { element: string; awaits: string }

const STORE = 'apps/workspace/bff/base-knowledge/store/repository.ts'
const SERVICE = 'apps/workspace/bff/base-knowledge/office/service.ts'
const TURN = 'apps/workspace/bff/base-knowledge/office/turn-block.ts'
const STORE_SPEC = 'apps/workspace/bff/base-knowledge/store/repository.integration.spec.ts'
const SERVICE_SPEC = 'apps/workspace/bff/base-knowledge/office/service.spec.ts'
const TURN_SPEC = 'apps/workspace/bff/base-knowledge/office/turn-block.spec.ts'
const FRESHNESS_SPEC = 'apps/workspace/bff/base-knowledge/office/freshness.spec.ts'
const TEXT_USE_SPEC = 'apps/workspace/bff/base-knowledge/office/text-use.spec.ts'
const OFFICE_FILTER_SPEC = 'packages/knowledge-layer/tests/test_vector_store_office_filter.py'
const MARK_SPEC = 'apps/agent-host/tests/test_knowledge_mark_route.py'

const ISOLATION = { file: STORE_SPEC, name: 'reads a proposal back to its office, and to no other office' }
const HEADS = { file: STORE_SPEC, name: 'moves the heads on confirmation, records the first check, and keeps the proposal in the history' }
const APPEND_ONLY = { file: STORE_SPEC, name: 'refuses to update or delete a revision, a body or a check on its own' }
const CROSS_OWNER = { file: STORE_SPEC, name: 'refuses a copy on another office’s edition, and a tenant write of a platform row' }
const RESIDUE = { file: STORE_SPEC, name: 'leaves nothing behind once the document is deleted' }
const PROPOSAL = { file: SERVICE_SPEC, name: 'takes what the caller read over what the reading guessed, and says whose values they are' }
const NAMED = { file: TURN_SPEC, name: 'names the standard, its edition, its file and its last check' }
const DIRECTIVE = { file: TURN_SPEC, name: 'applies an MA 37 directive in Vienna, not in Graz, and says when the authority is unknown' }

const STICHTAG = 'S11 (ticket 30): edition selection by the project’s reference date'

export const KNOWLEDGE_CONSUMERS: readonly KnowledgeConsumer[] = [
  // knowledge_records
  { element: 'knowledge_records.id', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_records.organization_id', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_records.type', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_records.head_revision_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_records.document_id', consumer: STORE, test: RESIDUE },
  { element: 'knowledge_records.created_by', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_records.created_at', consumer: STORE, test: ISOLATION },
  // knowledge_revisions
  { element: 'knowledge_revisions.revision_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_revisions.record_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_revisions.record_type', consumer: STORE, test: HEADS },
  { element: 'knowledge_revisions.organization_id', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_revisions.created_by', consumer: STORE, test: APPEND_ONLY },
  { element: 'knowledge_revisions.created_at', consumer: STORE, test: HEADS },
  { element: 'knowledge_revisions.provenance', consumer: SERVICE, test: PROPOSAL },
  // knowledge_work_revisions
  { element: 'knowledge_work_revisions.revision_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_work_revisions.record_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_work_revisions.organization_id', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_work_revisions.kind', consumer: TURN, test: NAMED },
  { element: 'knowledge_work_revisions.title', consumer: TURN, test: NAMED },
  { element: 'knowledge_work_revisions.identifiers', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_work_revisions.territory_ids', consumer: SERVICE, test: PROPOSAL },
  { element: 'knowledge_work_revisions.issuer', consumer: SERVICE, test: PROPOSAL },
  { element: 'knowledge_work_revisions.addressees', consumer: TURN, test: DIRECTIVE },
  // knowledge_edition_revisions
  { element: 'knowledge_edition_revisions.revision_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_edition_revisions.record_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_edition_revisions.organization_id', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_edition_revisions.work_id', consumer: STORE, test: CROSS_OWNER },
  { element: 'knowledge_edition_revisions.label', consumer: TURN, test: NAMED },
  { element: 'knowledge_edition_revisions.issued_on', consumer: SERVICE, test: PROPOSAL },
  { element: 'knowledge_edition_revisions.in_force_from', awaits: STICHTAG },
  { element: 'knowledge_edition_revisions.in_force_to', awaits: STICHTAG },
  { element: 'knowledge_edition_revisions.outline', awaits: 'S8: clause anchors from the masthead outline' },
  // knowledge_manifestation_revisions
  { element: 'knowledge_manifestation_revisions.revision_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_manifestation_revisions.record_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_manifestation_revisions.organization_id', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_manifestation_revisions.edition_id', consumer: STORE, test: CROSS_OWNER },
  { element: 'knowledge_manifestation_revisions.form', awaits: 'S7: link and dataset manifestations of platform sources' },
  { element: 'knowledge_manifestation_revisions.language', awaits: 'S2: the multilingual quoting rule' },
  { element: 'knowledge_manifestation_revisions.text_status', awaits: 'S7: official non-prevailing texts (South Tyrol)' },
  { element: 'knowledge_manifestation_revisions.licence_class', consumer: 'apps/workspace/bff/base-knowledge/office/text-use.ts', test: { file: TEXT_USE_SPEC, name: 'keeps a licensed copy metadata-only until the office states its licence covers AI processing' } },
  { element: 'knowledge_manifestation_revisions.terms', consumer: 'apps/workspace/bff/base-knowledge/office/text-use.ts', test: { file: TEXT_USE_SPEC, name: 'records who stated what and when, keeps what was not restated, and lets the AI statement be withdrawn' } },
  { element: 'knowledge_manifestation_revisions.sha256', awaits: 'S7: captured platform sources, compared on re-fetch' },
  // knowledge_checks
  { element: 'knowledge_checks.id', consumer: STORE, test: RESIDUE },
  { element: 'knowledge_checks.organization_id', consumer: STORE, test: RESIDUE },
  { element: 'knowledge_checks.target_id', consumer: STORE, test: RESIDUE },
  { element: 'knowledge_checks.target_type', consumer: STORE, test: RESIDUE },
  { element: 'knowledge_checks.checked_at', consumer: 'apps/workspace/bff/base-knowledge/office/freshness.ts', test: { file: FRESHNESS_SPEC, name: 'holds a standard for a year and a directive for half of one' } },
  { element: 'knowledge_checks.checked_by', consumer: STORE, test: HEADS },
  { element: 'knowledge_checks.result', consumer: 'apps/workspace/bff/base-knowledge/office/freshness.ts', test: { file: FRESHNESS_SPEC, name: 'is overdue when never checked, or when the check found a newer edition' } },
  { element: 'knowledge_checks.note', consumer: STORE, test: HEADS },
  // Behaviour-bearing values: each kind binds differently, each licence class is used differently.
  { element: 'knowledge_work_revisions.kind=technical_standard', consumer: TURN, test: NAMED },
  { element: 'knowledge_work_revisions.kind=guideline', consumer: 'apps/workspace/bff/base-knowledge/office/freshness.ts', test: { file: FRESHNESS_SPEC, name: 'holds a standard for a year and a directive for half of one' } },
  { element: 'knowledge_work_revisions.kind=commentary', consumer: TURN, test: { file: TURN_SPEC, name: 'marks a commentary as interpretation only' } },
  { element: 'knowledge_work_revisions.kind=authority_directive', consumer: TURN, test: DIRECTIVE },
  { element: 'knowledge_work_revisions.kind=statute', consumer: TURN, test: NAMED },
  { element: 'knowledge_manifestation_revisions.licence_class=licensed', consumer: 'apps/workspace/bff/base-knowledge/office/text-use.ts', test: { file: TEXT_USE_SPEC, name: 'keeps a licensed copy metadata-only until the office states its licence covers AI processing' } },
  { element: 'knowledge_manifestation_revisions.licence_class=public_open', consumer: 'apps/workspace/bff/base-knowledge/office/text-use.ts', test: { file: TEXT_USE_SPEC, name: 'uses a public copy’s text without any statement' } },
  { element: 'knowledge_manifestation_revisions.licence_class=public_restricted', consumer: 'apps/workspace/bff/base-knowledge/office/text-use.ts', test: { file: TEXT_USE_SPEC, name: 'uses a public copy’s text without any statement' } },
  // The search-index payload fields this layer writes or filters on.
  { element: 'point.office_id', consumer: 'packages/knowledge-layer/src/vector_store/scope.py', test: { file: OFFICE_FILTER_SPEC, name: 'test_office_a_never_reads_office_bs_point_in_a_shared_scope' } },
  { element: 'point.licence_class', consumer: 'apps/agent-host/src/agent_host/routes/knowledge_mark.py', test: { file: MARK_SPEC, name: 'test_the_mark_lands_on_every_chunk_of_the_file' } },
  { element: 'point.knowledge_edition_id', consumer: 'packages/knowledge-layer/src/vector_store/writes.py', test: { file: MARK_SPEC, name: 'test_the_ingest_job_carries_the_mark_into_its_config' } },
]

/** The elements written before anything reads them, when this ledger was made. Remove a line when its reader lands; never add one. */
export const AWAITING_BASELINE: readonly string[] = [
  'knowledge_edition_revisions.in_force_from',
  'knowledge_edition_revisions.in_force_to',
  'knowledge_edition_revisions.outline',
  'knowledge_manifestation_revisions.form',
  'knowledge_manifestation_revisions.language',
  'knowledge_manifestation_revisions.text_status',
  'knowledge_manifestation_revisions.sha256',
]
