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

const TIME_READ = 'apps/workspace/bff/base-knowledge/time/repository.ts'
const PLATFORM_TERRITORIES = 'apps/workspace/bff/base-knowledge/platform/territories.ts'
const TIME_READ_TEST = {
  file: 'apps/workspace/bff/base-knowledge/time/time.integration.spec.ts',
  name: 'reads the released editions with their dates, transition and history start',
}

const PLATFORM_SPEC = 'apps/workspace/bff/base-knowledge/platform/platform.integration.spec.ts'
const PLATFORM_STORE = 'apps/workspace/bff/base-knowledge/platform/store.ts'
const PLATFORM_RELEASE = 'apps/workspace/bff/base-knowledge/platform/release.ts'
const PLATFORM_READ = 'apps/workspace/bff/base-knowledge/platform/office-read.ts'
const PLATFORM_INDEXING = 'apps/workspace/bff/base-knowledge/platform/indexing.ts'
const PLATFORM_ENTITLEMENTS = 'apps/workspace/bff/base-knowledge/platform/entitlements.ts'
const PLATFORM_VALIDATE = 'apps/workspace/bff/base-knowledge/platform/validate.ts'
const REVIEW_FOUR_EYES = {
  file: PLATFORM_SPEC,
  name: 'refuses a verdict by the request’s own author (four eyes), and takes the expert’s with its source',
}
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
  name: 'names a seat territory that is not imported, and a territory outside the request’s country, by pointer',
}
const ONBOARDING_SPEC = 'apps/workspace/bff/agent-api/onboarding-door.integration.spec.ts'
const PLATFORM_CAPTURES = 'apps/workspace/bff/base-knowledge/platform/captures.ts'
const CAPTURED = {
  file: ONBOARDING_SPEC,
  name: 'captures the pages: fetched through the source reader, or supplied by the operator, and refuses a host off the source',
}
const QUOTES_CHECKED = { file: ONBOARDING_SPEC, name: 'names every mistake of the draft by record, check and JSON Pointer, and writes nothing of a refused batch' }
const SOURCES_CHECKED = {
  file: ONBOARDING_SPEC,
  name: 'approves only on the person’s yes, never the author’s, and only once the operator-supplied sources were checked',
}
const TIME = 'S11 (time and editions): a territory valid at the project’s reference date, mergers by successor'
const SETUP = 'S9 (setup facts): competence by authority function, and authority identifiers (PVOG, Behördenkennzahl)'
const ADDRESS = 'S12 (address resolution): a territory found by its name, kind or register alias'

const SYNTH_SPEC = 'apps/workspace/bff/agent-api/synthetic-country-door.integration.spec.ts'
const PLATFORM_SOURCES = 'apps/workspace/bff/base-knowledge/platform/sources.ts'
const PLATFORM_RECORDS = 'apps/workspace/bff/base-knowledge/platform/records.ts'
const PLATFORM_MONITOR = 'apps/workspace/bff/base-knowledge/platform/monitor.ts'
const SOURCE_KC7 = { file: SYNTH_SPEC, name: 'imports the fixture territory and proposes the source, refused by KC-7 until its fixture is on its hosts' }
const SOURCE_TESTING = { file: SYNTH_SPEC, name: 'opens the draft source’s hosts to its own request only, for testing' }
const SOURCE_REVIEWED = { file: SYNTH_SPEC, name: 'needs counsel’s approval for an advice policy: one domain expert’s yes leaves it submitted' }
const SOURCE_KEY = { file: SYNTH_SPEC, name: 'reads the published source’s state, and takes its key only on the person’s yes, never giving it back' }
const SOURCE_MONITOR = { file: SYNTH_SPEC, name: 'opens one change request when the source changes, never publishes, and the agent finds it by origin' }

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
  { element: 'knowledge_work_revisions.history_available_from', consumer: TIME_READ, test: TIME_READ_TEST },
  // knowledge_edition_revisions
  { element: 'knowledge_edition_revisions.revision_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_edition_revisions.record_id', consumer: STORE, test: HEADS },
  { element: 'knowledge_edition_revisions.organization_id', consumer: STORE, test: ISOLATION },
  { element: 'knowledge_edition_revisions.work_id', consumer: STORE, test: CROSS_OWNER },
  { element: 'knowledge_edition_revisions.label', consumer: TURN, test: NAMED },
  { element: 'knowledge_edition_revisions.issued_on', consumer: SERVICE, test: PROPOSAL },
  { element: 'knowledge_edition_revisions.in_force_from', consumer: TIME_READ, test: TIME_READ_TEST },
  { element: 'knowledge_edition_revisions.in_force_to', consumer: TIME_READ, test: TIME_READ_TEST },
  { element: 'knowledge_edition_revisions.transition', consumer: TIME_READ, test: TIME_READ_TEST },
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
  { element: 'knowledge_territory_revisions.parent_ids', consumer: PLATFORM_TERRITORIES, test: MA37 },
  { element: 'knowledge_territory_revisions.kind', awaits: ADDRESS },
  { element: 'knowledge_territory_revisions.name', awaits: ADDRESS },
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
  { element: 'knowledge_review_decisions.decision_source', consumer: PLATFORM_STORE, test: REVIEW_FOUR_EYES },
  { element: 'knowledge_review_decisions.decided_at', consumer: PLATFORM_STORE, test: ROUND_TRIP },
  { element: 'knowledge_review_decisions.source_checked', consumer: PLATFORM_STORE, test: SOURCES_CHECKED },
  { element: 'knowledge_citation_captures.id', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.change_request_id', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.basis', consumer: PLATFORM_CAPTURES, test: SOURCES_CHECKED },
  { element: 'knowledge_citation_captures.source_id', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.url', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.final_url', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.content_type', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.sha256', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.byte_size', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.text', consumer: PLATFORM_CAPTURES, test: QUOTES_CHECKED },
  { element: 'knowledge_citation_captures.note', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.retrieved_at', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.created_by', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.via_client', consumer: PLATFORM_CAPTURES, test: CAPTURED },
  { element: 'knowledge_citation_captures.created_at', consumer: PLATFORM_CAPTURES, test: CAPTURED },
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
  // Migration 0210 (ADR-0174): public sources as platform records, their keys and monitors.
  { element: 'knowledge_source_revisions.revision_id', consumer: PLATFORM_SOURCES, test: SOURCE_TESTING },
  { element: 'knowledge_source_revisions.record_id', consumer: PLATFORM_SOURCES, test: SOURCE_TESTING },
  { element: 'knowledge_source_revisions.organization_id', consumer: PLATFORM_RECORDS, test: SOURCE_REVIEWED },
  { element: 'knowledge_source_revisions.title', consumer: PLATFORM_RECORDS, test: SOURCE_REVIEWED },
  { element: 'knowledge_source_revisions.territory_id', consumer: PLATFORM_RECORDS, test: SOURCE_REVIEWED },
  { element: 'knowledge_source_revisions.protocol', consumer: PLATFORM_RECORDS, test: SOURCE_REVIEWED },
  { element: 'knowledge_source_revisions.format', consumer: PLATFORM_RECORDS, test: SOURCE_REVIEWED },
  { element: 'knowledge_source_revisions.hosts', consumer: PLATFORM_SOURCES, test: SOURCE_TESTING },
  { element: 'knowledge_source_revisions.data_flow', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_revisions.monitor_kind', consumer: PLATFORM_SOURCES, test: SOURCE_MONITOR },
  { element: 'knowledge_source_revisions.monitor_interval_hours', consumer: PLATFORM_SOURCES, test: SOURCE_MONITOR },
  { element: 'knowledge_source_revisions.licence', consumer: PLATFORM_RECORDS, test: SOURCE_REVIEWED },
  { element: 'knowledge_source_revisions.config', consumer: PLATFORM_SOURCES, test: SOURCE_KC7 },
  { element: 'knowledge_source_credentials.id', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.record_id', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.organization_id', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.secret_backend', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.vault_object_id', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.encrypted_key', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.key_hint', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.set_by', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.decision_source', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.set_at', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_credentials.replaced_at', consumer: PLATFORM_SOURCES, test: SOURCE_KEY },
  { element: 'knowledge_source_monitor_states.record_id', consumer: PLATFORM_MONITOR, test: SOURCE_MONITOR },
  { element: 'knowledge_source_monitor_states.checked_at', consumer: PLATFORM_MONITOR, test: SOURCE_MONITOR },
  { element: 'knowledge_source_monitor_states.ok_at', consumer: PLATFORM_MONITOR, test: SOURCE_MONITOR },
  { element: 'knowledge_source_monitor_states.failure', consumer: PLATFORM_MONITOR, test: SOURCE_MONITOR },
  { element: 'knowledge_source_monitor_states.etag', consumer: PLATFORM_MONITOR, test: SOURCE_MONITOR },
  { element: 'knowledge_source_monitor_states.sha256', consumer: PLATFORM_MONITOR, test: SOURCE_MONITOR },
  { element: 'knowledge_source_monitor_states.version', consumer: PLATFORM_MONITOR, test: SOURCE_MONITOR },
  { element: 'knowledge_source_monitor_states.terms_sha256', consumer: PLATFORM_MONITOR, test: SOURCE_MONITOR },
  { element: 'knowledge_change_requests.origin', consumer: PLATFORM_STORE, test: SOURCE_MONITOR },
  { element: 'knowledge_change_requests.source_record_id', consumer: PLATFORM_STORE, test: SOURCE_MONITOR },
  { element: 'knowledge_change_requests.monitor_finding', consumer: PLATFORM_STORE, test: SOURCE_MONITOR },
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
  'knowledge_territory_revisions.name',
  'knowledge_territory_revisions.aliases',
  'knowledge_territory_revisions.valid_from',
  'knowledge_territory_revisions.valid_to',
  'knowledge_authority_revisions.function_codes',
  'knowledge_authority_revisions.identifiers',
]
