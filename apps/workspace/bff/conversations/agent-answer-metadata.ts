import { CITATIONS_PAYLOAD_VERSION } from '@/features/chat/lib/citations'
import { modernizeLane } from '@/lib/source-kinds'
import { LEGACY_BINDING_STATUS } from '@/features/chat/lib/wire-citation'
import type { WireCitationSource } from '@/features/chat/types'
import { citationLineOf, type CitationLineWire } from '@/shared/citation-line'
import { sanitizeProvenance, type MessageProvenance } from './message-provenance'
import { toProjectStatus, type ProjectStatus } from '@/lib/projects/project-status'
import { sanitizeAnswerMeta } from './message-answer-meta'
import { sanitizeFindings } from './message-findings'

const BACKEND_ANSWER_KEYS = [
  'sources',
  'licensed_text',
  'read_sources',
  'answer_confidence',
  'answer_confidence_reason',
  'answer_confidence_capped_reason',
  'deep_research_job_id',
  'research_truncated',
  'truncation_reason',
  'degraded_reasons',
  'citations_removed',
  'answer_meta',
  'findings',
  'retrieval_ledger',
  'quote_stamps',
  'claim_stamps',
  'confidence_check',
  'answer_confidence_version',
  'lookup_found_nothing',
  'routing_decision',
  'escalation_reason',
  'skills_activated',
  'skills_hidden',
  'reasoning_effort',
  'stopped',
] as const

const MAX_SOURCES = 200

const MAX_CONTENT = 400

const MAX_TEXT = 500
const MAX_IDENTIFIER = 256

const MAX_SNIPPET = 1200

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined

const positiveInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined

export type StoredCitationSource = Partial<
  Pick<
    WireCitationSource,
    | 'content'
    | 'url'
    | 'title'
    | 'citation_key'
    | 'document_id'
    | 'collection'
    | 'source_type'
    | 'tool'
    | 'origin'
    | 'number'
    | 'file_name'
    | 'page'
    | 'kind'
    | 'shelf'
    | 'lane'
    | 'lane_label'
    | 'binding_note'
    | 'binding_status'
    | 'clause'
    | 'score'
    | 'snippet'
  >
> &
  CitationLineWire & {
  is_cited?: boolean
  project?: { id: string; name: string; status: ProjectStatus }
}

export interface StoredCitations {
  v: typeof CITATIONS_PAYLOAD_VERSION
  sources: StoredCitationSource[]
}

function storedProject(value: unknown): StoredCitationSource['project'] {
  if (!isRecord(value)) return undefined
  const id = text(value.id, MAX_IDENTIFIER)
  if (!id) return undefined
  return { id, name: text(value.name, MAX_TEXT) ?? '', status: toProjectStatus(value.status) }
}

function normalizeSource(input: unknown): StoredCitationSource | null {
  if (!isRecord(input)) return null

  const source: StoredCitationSource = {
    content: text(input.content, MAX_CONTENT),
    url: text(input.url, MAX_TEXT),
    title: text(input.title, MAX_TEXT),
    citation_key: text(input.citation_key, MAX_IDENTIFIER),
    document_id: text(input.document_id, MAX_IDENTIFIER),
    file_name: text(input.file_name, MAX_TEXT),
    page: positiveInt(input.page),
    collection: text(input.collection, MAX_IDENTIFIER),
    source_type: text(input.source_type, MAX_IDENTIFIER),
    origin: text(input.origin, MAX_IDENTIFIER),
    shelf: text(input.shelf, MAX_IDENTIFIER),
    kind: text(input.kind, MAX_IDENTIFIER),
    lane: text(modernizeLane(input.lane as string | undefined), MAX_IDENTIFIER),
    lane_label: text(input.lane_label, MAX_TEXT),
    binding_note: text(input.binding_note, MAX_TEXT),
    binding_status: text(
      typeof input.binding_status === 'string'
        ? (LEGACY_BINDING_STATUS[input.binding_status] ?? input.binding_status)
        : input.binding_status,
      MAX_IDENTIFIER
    ),
    tool: text(input.tool, MAX_IDENTIFIER),
    clause: text(input.clause ?? input.punkt, MAX_IDENTIFIER),
    score:
      typeof input.score === 'number' && Number.isFinite(input.score) ? input.score : undefined,
    snippet: text(input.snippet, MAX_SNIPPET),
    number: positiveInt(input.number),
    project: storedProject(input.project),
    ...(typeof input.is_cited === 'boolean' ? { is_cited: input.is_cited } : {}),
    ...citationLineOf(input),
  }

  const identifying =
    source.url ??
    source.file_name ??
    source.document_id ??
    source.citation_key ??
    source.title ??
    source.content
  if (!identifying) return null

  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined)
  ) as StoredCitationSource
}

function normalizeReadSource(input: unknown): StoredCitationSource | null {
  if (!isRecord(input)) return null

  const source: StoredCitationSource = {
    document_id: text(input.document_id, MAX_IDENTIFIER),
    citation_key: text(input.citation_key, MAX_IDENTIFIER),
    file_name: text(input.file_name, MAX_TEXT),
    page: positiveInt(input.page),
    collection: text(input.collection, MAX_IDENTIFIER),
    shelf: text(input.shelf, MAX_IDENTIFIER),
    kind: text(input.kind, MAX_IDENTIFIER),
    lane: text(input.lane, MAX_IDENTIFIER),
    lane_label: text(input.lane_label, MAX_TEXT),
    title: text(input.title, MAX_TEXT),
    url: text(input.url, MAX_TEXT),
  }

  const identifying =
    source.url ?? source.file_name ?? source.document_id ?? source.citation_key ?? source.title
  if (!identifying) return null

  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined)
  ) as StoredCitationSource
}

function encodeSources(
  input: unknown,
  normalize: (input: unknown) => StoredCitationSource | null
): StoredCitations | undefined {
  if (!Array.isArray(input)) return undefined
  const sources = input
    .slice(0, MAX_SOURCES)
    .map(normalize)
    .filter((source): source is StoredCitationSource => source !== null)
  return sources.length > 0 ? { v: CITATIONS_PAYLOAD_VERSION, sources } : undefined
}

export function encodeBackendSources(input: unknown): StoredCitations | undefined {
  return encodeSources(input, normalizeSource)
}

export function encodeBackendReadSources(input: unknown): StoredCitations | undefined {
  return encodeSources(input, normalizeReadSource)
}

export function provenanceFromBackendMetadata(
  metadata: Record<string, unknown>
): MessageProvenance | null {
  const candidate: Record<string, unknown> = {}

  if (typeof metadata.answer_confidence === 'string') {
    candidate.answerConfidence = metadata.answer_confidence
  }
  if (typeof metadata.answer_confidence_reason === 'string') {
    candidate.answerConfidenceReason = metadata.answer_confidence_reason
  }
  if (typeof metadata.answer_confidence_capped_reason === 'string') {
    candidate.answerConfidenceCappedReason = metadata.answer_confidence_capped_reason
  }
  if (typeof metadata.deep_research_job_id === 'string') {
    candidate.deepResearchJobId = metadata.deep_research_job_id
  }
  if (typeof metadata.routing_decision === 'string') {
    candidate.routingDecision = metadata.routing_decision
  }
  if (typeof metadata.escalation_reason === 'string') {
    candidate.escalationReason = metadata.escalation_reason
  }
  if (Array.isArray(metadata.skills_activated))
    candidate.skillsActivated = metadata.skills_activated
  if (Array.isArray(metadata.skills_hidden)) candidate.skillsHidden = metadata.skills_hidden
  candidate.reasoningEffort = metadata.reasoning_effort

  if (metadata.research_truncated === true) candidate.researchTruncated = true
  if (metadata.stopped === true) candidate.stopped = true
  if (typeof metadata.truncation_reason === 'string') {
    candidate.truncationReason = metadata.truncation_reason
  }
  if (Array.isArray(metadata.degraded_reasons)) {
    candidate.degradedReasons = metadata.degraded_reasons
  }
  if (isRecord(metadata.citations_removed)) {
    candidate.citationsRemoved = metadata.citations_removed
  }

  candidate.retrievalLedger = metadata.retrieval_ledger
  candidate.quoteStamps = metadata.quote_stamps
  candidate.confidenceCheck = metadata.confidence_check
  candidate.answerConfidenceVersion = metadata.answer_confidence_version
  if (metadata.lookup_found_nothing === true) candidate.lookupFoundNothing = true

  return sanitizeProvenance(candidate)
}

export function normalizeAgentAnswerMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!metadata) return metadata

  const hasBackendKeys = BACKEND_ANSWER_KEYS.some((key) => metadata[key] !== undefined)
  if (!hasBackendKeys) return metadata

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if ((BACKEND_ANSWER_KEYS as readonly string[]).includes(key)) continue
    out[key] = value
  }

  if (out.citations === undefined) {
    const citations = encodeBackendSources(metadata.sources)
    if (citations) out.citations = citations
  }

  if (out.readSources === undefined) {
    const readSources = encodeBackendReadSources(metadata.read_sources)
    if (readSources) out.readSources = readSources
  }

  if (out.provenance === undefined) {
    const provenance = provenanceFromBackendMetadata(metadata)
    if (provenance) out.provenance = provenance
  }

  if (out.answerMeta === undefined) {
    const answerMeta = sanitizeAnswerMeta(metadata.answer_meta)
    if (answerMeta) out.answerMeta = answerMeta
  }
  if (out.findings === undefined) {
    const findings = sanitizeFindings(metadata.findings)
    if (findings) out.findings = findings
  }
  if (metadata.licensed_text === true) out[LICENSED_TEXT_KEY] = true

  return out
}

export const LICENSED_TEXT_KEY = 'licensedText'

export const readLicensedText = (metadata: Record<string, unknown> | undefined): boolean =>
  metadata?.licensed_text === true
