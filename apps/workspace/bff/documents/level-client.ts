import type { DocumentWireRow } from '@/features/documents/lib/file-item'
import type { DocumentReadFamily } from './document-status'
import type { DocumentLevelDirection, DocumentLevelSort } from './list-cursor'
import type { ShelfSummary } from './shelf-summary-types'

export class LevelFetchError extends Error {
  constructor(readonly status: number) {
    super(`Shelf read failed (${status})`)
    this.name = 'LevelFetchError'
  }
}

export interface ShelfListingRoute {
  list: string
  listParams?: Readonly<Record<string, string>>
}

export interface ShelfServerFilters {
  agentAuthoredOnly?: boolean
  includeArchived?: boolean
}

export interface LevelPageRequest extends ShelfListingRoute, ShelfServerFilters {
  folderId?: string | null
  sort: DocumentLevelSort
  dir: DocumentLevelDirection
  q?: string
  states?: readonly DocumentReadFamily[]
  limit: number
}

export interface LevelPageBody {
  documents: DocumentWireRow[]
  nextCursor: string | null
  collectionName?: string
}

type Fetcher = typeof fetch

function serverFilterParams(params: URLSearchParams, filters: ShelfServerFilters): void {
  if (filters.agentAuthoredOnly) params.set('authoredBy', 'agent')
  if (filters.includeArchived) params.set('includeArchived', 'true')
}

export function levelPageUrl(request: LevelPageRequest): string {
  const params = new URLSearchParams({ ...(request.listParams ?? {}) })
  if (request.folderId !== undefined) params.set('folderId', request.folderId ?? 'root')
  params.set('sort', request.sort)
  params.set('dir', request.dir)
  const q = request.q?.trim() ?? ''
  if (q !== '') params.set('q', q)
  if (request.states && request.states.length > 0) params.set('state', request.states.join(','))
  serverFilterParams(params, request)
  params.set('limit', String(request.limit))
  return `${request.list}?${params.toString()}`
}

export function withQueryParam(url: string, key: string, value: string): string {
  const at = url.indexOf('?')
  const path = at === -1 ? url : url.slice(0, at)
  const params = new URLSearchParams(at === -1 ? '' : url.slice(at + 1))
  params.set(key, value)
  return `${path}?${params.toString()}`
}

export function shelfSummaryUrl(route: ShelfListingRoute, filters: ShelfServerFilters): string {
  const params = new URLSearchParams({ ...(route.listParams ?? {}) })
  serverFilterParams(params, filters)
  const query = params.toString()
  return query ? `${route.list}/summary?${query}` : `${route.list}/summary`
}

async function getJson(url: string, signal: AbortSignal | undefined, fetcher: Fetcher): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, { signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LevelFetchError(0)
  }
  if (!response.ok) throw new LevelFetchError(response.status)
  return response.json()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function fetchLevelPage(
  url: string,
  { signal, fetcher = fetch }: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<LevelPageBody> {
  const body = await getJson(url, signal, fetcher)
  if (!isRecord(body)) throw new LevelFetchError(0)
  return {
    documents: Array.isArray(body.documents) ? (body.documents as DocumentWireRow[]) : [],
    nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
    ...(typeof body.collectionName === 'string' ? { collectionName: body.collectionName } : {}),
  }
}

export async function fetchShelfSummary(
  url: string,
  { signal, fetcher = fetch }: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<ShelfSummary> {
  const body = await getJson(url, signal, fetcher)
  if (!isRecord(body) || !Array.isArray(body.folders) || !Array.isArray(body.failed)) throw new LevelFetchError(0)
  return {
    folders: body.folders as ShelfSummary['folders'],
    failed: body.failed as ShelfSummary['failed'],
    failedTruncated: body.failedTruncated === true,
  }
}

export const documentRowPath = (documentId: string): string => `/api/documents/${encodeURIComponent(documentId)}`

export async function fetchDocumentRow(
  documentId: string,
  { signal, fetcher = fetch }: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<DocumentWireRow | null> {
  try {
    const body = await getJson(documentRowPath(documentId), signal, fetcher)
    return isRecord(body) && isRecord(body.document) ? (body.document as DocumentWireRow) : null
  } catch (error) {
    if (error instanceof LevelFetchError && (error.status === 403 || error.status === 404)) return null
    throw error
  }
}
