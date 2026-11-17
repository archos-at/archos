import { downloadFetched, type FetchedDownload } from '@/lib/browser-download'
import type { SearchBody, SearchResponse, SearchScopeQuery, SuggestBody, SuggestResponse } from '@/lib/search/search-wire'

export type SearchExportFormat = 'csv' | 'xlsx'

export function scopeQueryString(scope: SearchScopeQuery): string {
  const params = new URLSearchParams()
  if (scope.scope && scope.scope !== 'office') params.set('scope', scope.scope)
  if (scope.projectId) params.set('projectId', scope.projectId)
  if (scope.folderId) params.set('folderId', scope.folderId)
  return params.toString()
}

export class SearchRequestError extends Error {
  constructor(readonly status: number) {
    super(`search failed (${status})`)
    this.name = 'SearchRequestError'
  }
}

export async function postSearch(
  scope: SearchScopeQuery,
  body: SearchBody,
  signal?: AbortSignal,
  onServerTiming?: (header: string | null) => void
): Promise<SearchResponse> {
  const query = scopeQueryString(scope)
  const response = await fetch(`/api/search${query ? `?${query}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new SearchRequestError(response.status)
  onServerTiming?.(response.headers.get('server-timing'))
  return (await response.json()) as SearchResponse
}

export async function postSuggest(scope: SearchScopeQuery, body: SuggestBody, signal?: AbortSignal): Promise<SuggestResponse> {
  const query = scopeQueryString(scope)
  const response = await fetch(`/api/search/suggest${query ? `?${query}` : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new SearchRequestError(response.status)
  return (await response.json()) as SuggestResponse
}

export function exportSearch(
  scope: SearchScopeQuery,
  body: SearchBody,
  format: SearchExportFormat,
  fallbackName: string
): Promise<FetchedDownload> {
  const params = new URLSearchParams(scopeQueryString(scope))
  params.set('format', format)
  const { cursor: _cursor, limit: _limit, facets: _facets, ...question } = body
  return downloadFetched(`/api/search/export?${params.toString()}`, `${fallbackName}.${format}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...question, kinds: ['document'] }),
  })
}
