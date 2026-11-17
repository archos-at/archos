import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { internalServiceHeaders } from '@/lib/internal-auth'
import { ApiError, BadRequestError, NotFoundError, UpstreamError } from '@/lib/api/errors'

export type KnowledgeFileState = 'ingested' | 'stale' | 'pending' | 'failed' | 'removed' | 'inconsistent'

export interface KnowledgeFile {
  fileName: string
  state: KnowledgeFileState
  sizeBytes: number | null
  chunkCount: number
  ingestedSha256: string | null
  currentSha256: string | null
  countryId: string | null
  ingestedAt: string | null
  summary: string | null
  docClass: string | null
  docClassSuggestion: string | null
  displayTitle: string | null
}

export interface KnowledgeBaseSummary {
  totalFiles: number
  ingested: number
  stale: number
  pending: number
  failed: number
  removed: number
  inconsistent: number
  totalChunks: number
}

export interface KnowledgeBaseStatus {
  collectionName: string
  collectionExists: boolean
  collectionUpdatedAt: string | null
  summary: KnowledgeBaseSummary
  files: KnowledgeFile[]
}

export const KNOWLEDGE_STATUS_TIMEOUT_MS = 30_000

interface BackendFileEntry {
  file_name?: unknown
  state?: unknown
  size_bytes?: unknown
  chunk_count?: unknown
  ingested_sha256?: unknown
  current_sha256?: unknown
  country_id?: unknown
  ingested_at?: unknown
  summary?: unknown
  doc_class?: unknown
  doc_class_suggestion?: unknown
  display_title?: unknown
}

const FILE_STATES: KnowledgeFileState[] = ['ingested', 'stale', 'pending', 'failed', 'removed', 'inconsistent']

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function mapFile(entry: BackendFileEntry): KnowledgeFile {
  const state = FILE_STATES.includes(entry.state as KnowledgeFileState)
    ? (entry.state as KnowledgeFileState)
    : 'pending'
  return {
    fileName: asString(entry.file_name) ?? 'unknown',
    state,
    sizeBytes: typeof entry.size_bytes === 'number' ? entry.size_bytes : null,
    chunkCount: asCount(entry.chunk_count),
    ingestedSha256: asString(entry.ingested_sha256),
    currentSha256: asString(entry.current_sha256),
    countryId: asString(entry.country_id),
    ingestedAt: asString(entry.ingested_at),
    summary: asString(entry.summary),
    docClass: asString(entry.doc_class),
    docClassSuggestion: asString(entry.doc_class_suggestion),
    displayTitle: asString(entry.display_title),
  }
}

const BACKEND_REASON_CHARS = 300

async function backendFailure(res: Response): Promise<UpstreamError> {
  const text = await res.text().catch(() => '')
  let reason = text
  try {
    const detail = (JSON.parse(text) as { detail?: unknown })?.detail
    if (typeof detail === 'string') reason = detail
  } catch {
    // Not JSON: the body as it came.
  }
  reason = reason.replace(/\s+/g, ' ').trim().slice(0, BACKEND_REASON_CHARS)
  return new UpstreamError(reason ? `Knowledge backend returned ${res.status}: ${reason}` : `Knowledge backend returned ${res.status}`)
}

export async function getKnowledgeBaseStatus(): Promise<KnowledgeBaseStatus> {
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/oib/status`, {
      signal: AbortSignal.timeout(KNOWLEDGE_STATUS_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (!res.ok) throw await backendFailure(res)

  const body = await res.json().catch(() => {
    throw new UpstreamError('Knowledge backend returned malformed JSON')
  })

  const summary = body?.summary ?? {}
  const files = Array.isArray(body?.files) ? body.files : []

  return {
    collectionName: asString(body?.collection_name) ?? '',
    collectionExists: body?.collection_exists === true,
    collectionUpdatedAt: asString(body?.collection_updated_at),
    summary: {
      totalFiles: asCount(summary.total_files),
      ingested: asCount(summary.ingested),
      stale: asCount(summary.stale),
      pending: asCount(summary.pending),
      failed: asCount(summary.failed),
      removed: asCount(summary.removed),
      inconsistent: asCount(summary.inconsistent),
      totalChunks: asCount(summary.total_chunks),
    },
    files: files.map(mapFile),
  }
}

export async function getReleasedKnowledgeBaseStatus(countries: readonly string[]): Promise<KnowledgeBaseStatus> {
  const status = await getKnowledgeBaseStatus()
  const files = status.files.filter((file) => file.countryId !== null && countries.includes(file.countryId))
  const count = (state: KnowledgeFileState): number => files.filter((file) => file.state === state).length
  return {
    ...status,
    summary: {
      totalFiles: files.length,
      ingested: count('ingested'),
      stale: count('stale'),
      pending: count('pending'),
      failed: count('failed'),
      removed: count('removed'),
      inconsistent: count('inconsistent'),
      totalChunks: files.reduce((sum, file) => sum + file.chunkCount, 0),
    },
    files,
  }
}

export function adminHeaders(): Record<string, string> {
  const token = process.env.ADMIN_TOKEN
  return token ? { 'X-Admin-Token': token } : {}
}

export function requirePdfBasename(fileName: string): string {
  const name = fileName.trim()
  if (!name || name !== name.replace(/[/\\]/g, '') || !name.toLowerCase().endsWith('.pdf')) {
    throw new BadRequestError('A .pdf file name without path segments is required')
  }
  return name
}

function requireUploadBasename(fileName: string): string {
  const name = fileName.trim()
  const lower = name.toLowerCase()
  if (!name || name !== name.replace(/[/\\]/g, '') || !(lower.endsWith('.pdf') || lower.endsWith('.zip'))) {
    throw new BadRequestError('A .pdf or .zip file name without path segments is required')
  }
  return name
}

export interface KnowledgeUploadMember {
  fileName: string
  status: 'pending' | 'rejected'
  docClass: string | null
  reason: string | null
}

export interface KnowledgeUploadResult {
  status: 'pending' | 'success' | 'failed' | 'timeout'
  kind: 'file' | 'zip'
  fileName: string | null
  docClass: string | null
  message: string
  accepted: number | null
  rejected: number | null
  members: KnowledgeUploadMember[] | null
}

export interface KnowledgeUploadOptions {
  docClass?: string
}

export async function uploadKnowledgeBaseDocument(
  file: File,
  options: KnowledgeUploadOptions = {},
): Promise<KnowledgeUploadResult> {
  const name = requireUploadBasename(file.name)
  const form = new FormData()
  form.append('file', file, name)
  if (options.docClass) {
    form.append('doc_class', options.docClass)
  }

  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/admin/oib/documents`, {
      method: 'POST',
      headers: adminHeaders(),
      body: form,
      signal: AbortSignal.timeout(660_000),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (res.status === 409) {
    throw new ApiError(409, 'NAME_TAKEN', `The base corpus keeps other bytes as ${name}; nothing is replaced.`, {
      hint: 'Remove that file from the base corpus first if no record names it, or upload it under another name.',
    })
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new UpstreamError(`Knowledge backend returned ${res.status}`, detail.slice(0, 500))
  }
  const body = await res.json().catch(() => ({}))
  const rawStatus = body?.status
  const status =
    rawStatus === 'pending' || rawStatus === 'success' || rawStatus === 'failed' || rawStatus === 'timeout'
      ? rawStatus
      : 'failed'
  const members = Array.isArray(body?.members)
    ? body.members.map(
        (m: Record<string, unknown>): KnowledgeUploadMember => ({
          fileName: asString(m?.file_name) ?? 'unknown',
          status: m?.status === 'pending' ? 'pending' : 'rejected',
          docClass: asString(m?.doc_class),
          reason: asString(m?.reason),
        }),
      )
    : null
  return {
    status,
    kind: body?.kind === 'zip' ? 'zip' : 'file',
    fileName: asString(body?.file_name),
    docClass: asString(body?.doc_class),
    message: asString(body?.message) ?? '',
    accepted: typeof body?.accepted === 'number' ? body.accepted : null,
    rejected: typeof body?.rejected === 'number' ? body.rejected : null,
    members,
  }
}

export async function updateKnowledgeBaseDocClass(fileName: string, docClass: string): Promise<void> {
  const name = requirePdfBasename(fileName)
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/admin/oib/documents/${encodeURIComponent(name)}/doc-class`, {
      method: 'PATCH',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_class: docClass }),
      signal: AbortSignal.timeout(KNOWLEDGE_STATUS_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (res.status === 400) {
    const detail = await res.text().catch(() => '')
    throw new BadRequestError(detail.slice(0, 500) || 'Invalid doc_class')
  }
  if (res.status === 404) {
    throw new NotFoundError('No summary found for that document')
  }
  if (!res.ok) throw await backendFailure(res)
}

export async function updateKnowledgeBaseDisplayTitle(
  fileName: string,
  displayTitle: string | null,
): Promise<void> {
  const name = requirePdfBasename(fileName)
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/admin/oib/documents/${encodeURIComponent(name)}/display-title`, {
      method: 'PATCH',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_title: displayTitle }),
      signal: AbortSignal.timeout(KNOWLEDGE_STATUS_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (res.status === 404) {
    throw new NotFoundError('No summary found for that document')
  }
  if (!res.ok) throw await backendFailure(res)
}

export async function deleteKnowledgeBaseDocument(fileName: string): Promise<void> {
  const name = requirePdfBasename(fileName)
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/admin/oib/documents/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: adminHeaders(),
      signal: AbortSignal.timeout(KNOWLEDGE_STATUS_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (res.status === 404) {
    throw new NotFoundError('No base-corpus document with that name')
  }
  if (!res.ok) throw await backendFailure(res)
}

export interface KnowledgeSyncResult {
  filesAdded: number
  filesTotal: number
  message: string
}

export async function syncKnowledgeBase(): Promise<KnowledgeSyncResult> {
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/admin/oib/sync`, {
      method: 'POST',
      headers: adminHeaders(),
      signal: AbortSignal.timeout(660_000),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (!res.ok) throw await backendFailure(res)
  const body = await res.json().catch(() => ({}))
  return {
    filesAdded: asCount(body?.files_added),
    filesTotal: asCount(body?.files_total),
    message: asString(body?.message) ?? '',
  }
}

export interface KnowledgeReingestResult {
  status: 'pending' | 'noop'
  queued: string[]
  unknown: string[]
  message: string
}

export interface CorpusFileMark {
  countryId: string | null
  editionId: string | null
}

export async function reingestKnowledgeBaseDocuments(
  fileNames: string[],
  marks: Readonly<Record<string, CorpusFileMark>> = {},
): Promise<KnowledgeReingestResult> {
  const names = fileNames.map(requirePdfBasename)
  if (names.length === 0) {
    throw new BadRequestError('Select at least one document to re-ingest')
  }
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/admin/oib/reingest`, {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_names: names,
        ...(Object.keys(marks).length > 0
          ? { marks: Object.fromEntries(Object.entries(marks).map(([name, mark]) => [name, { country_id: mark.countryId, edition_id: mark.editionId }])) }
          : {}),
      }),
      signal: AbortSignal.timeout(KNOWLEDGE_STATUS_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (!res.ok) throw await backendFailure(res)
  const body = await res.json().catch(() => ({}))
  const queued: string[] = Array.isArray(body?.queued) ? body.queued.map(String) : []
  const released = new Set(Array.isArray(body?.released) ? body.released.map(String) : [])
  const unreleased = queued.filter((name) => Object.hasOwn(marks, name) && !released.has(name))
  if (unreleased.length > 0) throw new UpstreamError(`Knowledge backend did not release ${unreleased.join(', ')}`)
  return {
    status: body?.status === 'noop' ? 'noop' : 'pending',
    queued,
    unknown: Array.isArray(body?.unknown) ? body.unknown.map(String) : [],
    message: asString(body?.message) ?? '',
  }
}

export async function streamKnowledgeBaseCorpus(): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/admin/oib/corpus.tar.gz`, {
      headers: adminHeaders(),
      signal: AbortSignal.timeout(600_000),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (!res.ok || !res.body) {
    throw new UpstreamError(`Knowledge backend returned ${res.status}`)
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': 'attachment; filename="oib-corpus.tar.gz"',
      'Cache-Control': 'no-store',
    },
  })
}

export async function withdrawCorpusFile(fileName: string): Promise<void> {
  const name = requirePdfBasename(fileName)
  const backendUrl = getBackendUrl()
  const collection = process.env.BASE_COLLECTION_NAME || 'oib_knowledge'
  const res = await fetch(`${backendUrl}/v1/collections/${encodeURIComponent(collection)}/knowledge-mark`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...internalServiceHeaders(backendUrl) },
    body: JSON.stringify({ file_name: name, released: false }),
    signal: AbortSignal.timeout(KNOWLEDGE_STATUS_TIMEOUT_MS),
  })
  if (!res.ok) throw new UpstreamError(`Knowledge backend returned ${res.status} marking ${name}`)
  const result = (await res.json().catch(() => null)) as { released?: unknown } | null
  if (result?.released !== false) throw new UpstreamError(`Knowledge backend did not withdraw ${name}`)
}
