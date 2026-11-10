/**
 * The element ledger of the base knowledge records (design §3.10, ADR-0163):
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


const CHAIN_RESOLVE = 'apps/workspace/bff/base-knowledge/chain/resolve.ts'
const CHAIN_TEXT = 'apps/workspace/bff/base-knowledge/chain/text.ts'
const CHAIN_LOAD = 'apps/workspace/bff/base-knowledge/chain/load.ts'
const CHAIN_MIGRATION = 'apps/workspace/migrations/0206_country_pack.sql'
const RESOLVE_SPEC = 'apps/workspace/bff/base-knowledge/chain/resolve.spec.ts'
const TEXT_SPEC = 'apps/workspace/bff/base-knowledge/chain/text.spec.ts'
const CHAIN_SPEC = 'apps/workspace/bff/base-knowledge/chain/chain.integration.spec.ts'
const ROUTE_WBTV = { file: RESOLVE_SPEC, name: 'route-wbtv-oib2: in Wien the WBTV declares OIB-RL 2 in its 2023 edition, with the route' }
const ASOF_VIENNA = { file: RESOLVE_SPEC, name: 'asof-vienna: Wien binds RL 6 in 2023 before 2026-07-15 and in 2025 from that day' }
const DEVIATION = { file: RESOLVE_SPEC, name: 'deviation-wbtv-pkt: a WBTV clause displaces an OIB-RL 2 Punkt in Wien, and nowhere else' }
const OFFICE_ROUTE = { file: RESOLVE_SPEC, name: 'E37: an office relation makes a DIN edition binding as office_maintained, and a platform relation displaces it' }
const CROSS_PACK = { file: RESOLVE_SPEC, name: 'li-sia500: Liechtenstein law reaches SIA and VKF works in another pack through relations' }
const DATED_PARENT = { file: RESOLVE_SPEC, name: 'gb-2021-no-eu: Great Britain lies in the EU until the end of 2020, and not after' }
const EVERY_KIND = { file: RESOLVE_SPEC, name: '%s reads as its kind and route say' }
const LAW_DATED = { file: RESOLVE_SPEC, name: 'a law with editions none of which is in force at the date applies to nothing then' }
const CHAIN_NAMED = { file: TEXT_SPEC, name: 'names what binds in Wien, why, and the clause the Land displaces' }
const STYRIA_DB = { file: CHAIN_SPEC, name: 'reads the chain for Steiermark: OIB-RL 2 binds in 2019, and 2023 only guides (defect 7)' }
const REACHED = { file: CHAIN_SPEC, name: 'reads a record of another pack only where a released relation reaches it, and not after its rollback' }
const RELATION_GUARDS = { file: CHAIN_SPEC, name: 'keeps a relation append-only, and refuses a platform relation to an office record' }

const PLATFORM_SPEC = 'apps/workspace/bff/base-knowledge/platform/platform.integration.spec.ts'
const PLATFORM_STORE = 'apps/workspace/bff/base-knowledge/platform/store.ts'
const PLATFORM_RELEASE = 'apps/workspace/bff/base-knowledge/platform/release.ts'
const PLATFORM_READ = 'apps/workspace/bff/base-knowledge/platform/office-read.ts'
const PLATFORM_INDEXING = 'apps/workspace/bff/base-knowledge/platform/indexing.ts'
const PLATFORM_ENTITLEMENTS = 'apps/workspace/bff/base-knowledge/platform/entitlements.ts'
const PLATFORM_VALIDATE = 'apps/workspace/bff/base-knowledge/platform/validate.ts'
const ROUND_TRIP = { file: PLATFORM_SPEC, name: 'a rollback round trip: each head returns to where it was, and every move is kept' }
const LISTING = {
  file: PLATFORM_SPEC,
  name: 'a second office sees the std-asi listing as "gelistet, kein Text" once entitled to Austria, and not before',
}
const MA37 = { file: PLATFORM_SPEC, name: 'excludes an MA 37 directive for a project in Graz, and applies it in Vienna' }
const INDEXED = { file: PLATFORM_SPEC, name: 'gives a published text its indexing run, and reads it indexed once the corpus has its chunks' }
const INDEX_FAILED = { file: PLATFORM_SPEC, name: 'records a corpus that does not know the file as failed, with why' }
const FOUR_EYES = { file: PLATFORM_SPEC, name: 'refuses an approval by the request’s own author (four eyes)' }
const RACE = { file: PLATFORM_SPEC, name: 'publishes to stable only after preview, and refuses a record released by another request since' }
const SEAT = {
  file: 'apps/workspace/bff/base-knowledge/platform/validate.spec.ts',
  name: 'names a seat or competence territory that is not imported, and a territory outside the request’s country',
}
const TIME = 'S11 (time and editions): a territory valid at the project’s reference date, mergers by successor'
const SETUP = 'S9 (setup facts): competence by authority function, and authority identifiers (PVOG, Behördenkennzahl)'
const ADDRESS = 'S12 (address resolution): a territory found by its name, kind or register alias'

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
  { element: 'knowledge_edition_revisions.in_force_from', consumer: CHAIN_RESOLVE, test: LAW_DATED },
  { element: 'knowledge_edition_revisions.in_force_to', consumer: CHAIN_RESOLVE, test: LAW_DATED },
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
  { element: 'knowledge_work_revisions.kind=ordinance', consumer: CHAIN_RESOLVE, test: EVERY_KIND },
  { element: 'knowledge_work_revisions.kind=administrative_regulation', consumer: CHAIN_RESOLVE, test: EVERY_KIND },
  { element: 'knowledge_work_revisions.kind=directive', consumer: CHAIN_RESOLVE, test: EVERY_KIND },
  { element: 'knowledge_work_revisions.kind=intergovernmental_agreement', consumer: CHAIN_RESOLVE, test: EVERY_KIND },
  { element: 'knowledge_work_revisions.kind=model_code', consumer: CHAIN_RESOLVE, test: EVERY_KIND },
  { element: 'knowledge_manifestation_revisions.licence_class=licensed', consumer: 'apps/workspace/bff/base-knowledge/office/text-use.ts', test: { file: TEXT_USE_SPEC, name: 'keeps a licensed copy metadata-only until the office states its licence covers AI processing' } },
  { element: 'knowledge_manifestation_revisions.licence_class=public_open', consumer: 'apps/workspace/bff/base-knowledge/office/text-use.ts', test: { file: TEXT_USE_SPEC, name: 'uses a public copy’s text without any statement' } },
  { element: 'knowledge_manifestation_revisions.licence_class=public_restricted', consumer: 'apps/workspace/bff/base-knowledge/office/text-use.ts', test: { file: TEXT_USE_SPEC, name: 'uses a public copy’s text without any statement' } },
  // The search-index payload fields this layer writes or filters on.
  { element: 'point.office_id', consumer: 'packages/knowledge-layer/src/vector_store/scope.py', test: { file: OFFICE_FILTER_SPEC, name: 'test_office_a_never_reads_office_bs_point_in_a_shared_scope' } },
  { element: 'point.licence_class', consumer: 'apps/agent-host/src/agent_host/routes/knowledge_mark.py', test: { file: MARK_SPEC, name: 'test_the_mark_lands_on_every_chunk_of_the_file' } },
  // Read by the licensed seam (ADR-0159, `agent/common/licensed_text.py`), which lists a licensed point without text until both are there.
  { element: 'point.ai_processing_attested', consumer: 'packages/knowledge-layer/src/vector_store/writes.py', test: { file: OFFICE_FILTER_SPEC, name: 'test_the_seams_attestation_and_quote_cap_ride_along' } },
  { element: 'point.quote_max_chars', consumer: 'packages/knowledge-layer/src/vector_store/writes.py', test: { file: OFFICE_FILTER_SPEC, name: 'test_a_cap_that_is_no_positive_count_is_left_out' } },
  { element: 'point.knowledge_edition_id', consumer: 'packages/knowledge-layer/src/vector_store/writes.py', test: { file: MARK_SPEC, name: 'test_the_ingest_job_carries_the_mark_into_its_config' } },
  // Migration 0205 (ADR-0165): the platform's columns and tables.
  { element: 'knowledge_records.country_id', consumer: PLATFORM_READ, test: LISTING },
  { element: 'knowledge_revisions.change_request_id', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_manifestation_revisions.corpus_file', consumer: PLATFORM_READ, test: INDEXED },
  { element: 'knowledge_territory_revisions.revision_id', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_territory_revisions.record_id', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_territory_revisions.organization_id', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_territory_revisions.parent_ids', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_territory_revisions.kind', awaits: ADDRESS },
  { element: 'knowledge_territory_revisions.name', consumer: CHAIN_TEXT, test: CHAIN_NAMED },
  { element: 'knowledge_territory_revisions.dated_parents', consumer: CHAIN_RESOLVE, test: DATED_PARENT },
  // Migration 0206 (ADR-0168): relations, read by the resolver that gives every edition its role.
  { element: 'knowledge_relation_revisions.revision_id', consumer: CHAIN_LOAD, test: STYRIA_DB },
  { element: 'knowledge_relation_revisions.record_id', consumer: CHAIN_MIGRATION, test: REACHED },
  { element: 'knowledge_relation_revisions.organization_id', consumer: CHAIN_LOAD, test: OFFICE_ROUTE },
  { element: 'knowledge_relation_revisions.relation_type', consumer: CHAIN_RESOLVE, test: DEVIATION },
  { element: 'knowledge_relation_revisions.mode', consumer: CHAIN_TEXT, test: ROUTE_WBTV },
  { element: 'knowledge_relation_revisions.from_id', consumer: CHAIN_RESOLVE, test: ROUTE_WBTV },
  { element: 'knowledge_relation_revisions.from_type', consumer: CHAIN_RESOLVE, test: DEVIATION },
  { element: 'knowledge_relation_revisions.to_id', consumer: CHAIN_RESOLVE, test: CROSS_PACK },
  { element: 'knowledge_relation_revisions.to_type', consumer: CHAIN_RESOLVE, test: CROSS_PACK },
  { element: 'knowledge_relation_revisions.anchors', consumer: CHAIN_RESOLVE, test: DEVIATION },
  { element: 'knowledge_relation_revisions.provision', consumer: CHAIN_TEXT, test: ROUTE_WBTV },
  { element: 'knowledge_relation_revisions.valid_from', consumer: CHAIN_RESOLVE, test: ASOF_VIENNA },
  { element: 'knowledge_relation_revisions.valid_to', consumer: CHAIN_RESOLVE, test: RELATION_GUARDS },
  { element: 'knowledge_territory_revisions.aliases', awaits: ADDRESS },
  { element: 'knowledge_territory_revisions.valid_from', awaits: TIME },
  { element: 'knowledge_territory_revisions.valid_to', awaits: TIME },
  { element: 'knowledge_authority_revisions.revision_id', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_authority_revisions.record_id', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_authority_revisions.organization_id', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_authority_revisions.name', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_authority_revisions.competence_territory_ids', consumer: PLATFORM_READ, test: MA37 },
  { element: 'knowledge_authority_revisions.seat_territory_id', consumer: PLATFORM_VALIDATE, test: SEAT },
  { element: 'knowledge_authority_revisions.function_codes', awaits: SETUP },
  { element: 'knowledge_authority_revisions.identifiers', awaits: SETUP },
  { element: 'knowledge_change_requests.id', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_change_requests.title', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_change_requests.country_id', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_change_requests.status', consumer: PLATFORM_RELEASE, test: RACE },
  { element: 'knowledge_change_requests.base_release_seq', consumer: PLATFORM_RELEASE, test: RACE },
  { element: 'knowledge_change_requests.created_by', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_change_requests.created_at', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_change_requests.submitted_at', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_change_requests.decided_at', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_change_requests.published_at', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.id', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.change_request_id', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.revision_id', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.claim_path', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.decision', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.note', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.reviewer', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.decided_at', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_approvals.id', consumer: PLATFORM_STORE, test: FOUR_EYES },
  { element: 'knowledge_approvals.change_request_id', consumer: PLATFORM_STORE, test: FOUR_EYES },
  { element: 'knowledge_approvals.approver', consumer: PLATFORM_STORE, test: FOUR_EYES },
  { element: 'knowledge_approvals.role', consumer: PLATFORM_STORE, test: FOUR_EYES },
  { element: 'knowledge_approvals.decision_source', consumer: PLATFORM_STORE, test: FOUR_EYES },
  { element: 'knowledge_approvals.decided_at', consumer: PLATFORM_STORE, test: FOUR_EYES },
  { element: 'knowledge_release_moves.seq', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.record_id', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.channel', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.action', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.from_revision_id', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.to_revision_id', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.change_request_id', consumer: PLATFORM_RELEASE, test: RACE },
  { element: 'knowledge_release_moves.released_by', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.decision_source', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.released_at', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_release_moves.reason', consumer: PLATFORM_RELEASE, test: ROUND_TRIP },
  { element: 'knowledge_index_runs.id', consumer: PLATFORM_INDEXING, test: INDEXED },
  { element: 'knowledge_index_runs.revision_id', consumer: PLATFORM_INDEXING, test: INDEXED },
  { element: 'knowledge_index_runs.corpus_file', consumer: PLATFORM_INDEXING, test: INDEXED },
  { element: 'knowledge_index_runs.change_request_id', consumer: PLATFORM_INDEXING, test: INDEXED },
  { element: 'knowledge_index_runs.state', consumer: PLATFORM_INDEXING, test: INDEXED },
  { element: 'knowledge_index_runs.failure', consumer: PLATFORM_INDEXING, test: INDEX_FAILED },
  { element: 'knowledge_index_runs.requested_at', consumer: PLATFORM_INDEXING, test: INDEXED },
  { element: 'knowledge_index_runs.updated_at', consumer: PLATFORM_INDEXING, test: INDEXED },
  { element: 'organization_countries.organization_id', consumer: PLATFORM_ENTITLEMENTS, test: LISTING },
  { element: 'organization_countries.country_id', consumer: PLATFORM_ENTITLEMENTS, test: LISTING },
  { element: 'organization_countries.entitled_by', consumer: PLATFORM_ENTITLEMENTS, test: LISTING },
  { element: 'organization_countries.decision_source', consumer: PLATFORM_ENTITLEMENTS, test: LISTING },
  { element: 'organization_countries.entitled_at', consumer: PLATFORM_ENTITLEMENTS, test: LISTING },
]

/** The elements written before anything reads them, when this ledger was made. Remove a line when its reader lands; never add one. */
export const AWAITING_BASELINE: readonly string[] = [
  'knowledge_edition_revisions.outline',
  'knowledge_manifestation_revisions.form',
  'knowledge_manifestation_revisions.language',
  'knowledge_manifestation_revisions.text_status',
  'knowledge_manifestation_revisions.sha256',
  // Migration 0205's own, at its landing: the territory and authority fields the slices after S7 read.
  'knowledge_territory_revisions.kind',
  'knowledge_territory_revisions.aliases',
  'knowledge_territory_revisions.valid_from',
  'knowledge_territory_revisions.valid_to',
  'knowledge_authority_revisions.function_codes',
  'knowledge_authority_revisions.identifiers',
]
