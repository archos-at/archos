import { BACK_PARAM } from '@/features/documents/lib/open-review'
import { capturePosthog, type PostHogEvent } from '@/lib/analytics/posthog'
import type { DocumentFilters, SearchBody, SearchHit, SearchKind, SearchResponse, SearchScopeQuery, SuggestDimension } from '@/lib/search/search-wire'
import type { SearchSurface } from './search-surface'

export type SearchTelemetrySurface = 'palette' | 'page' | 'shelf' | 'composer'

export function telemetrySurface(surface: SearchSurface): SearchTelemetrySurface {
  return surface.kind === 'office' ? 'page' : 'shelf'
}

export const SEARCH_SETTLE_MS = 1000

export interface ServerTiming {
  sqlMs: number | null
  contentMs: number | null
}

export function parseServerTiming(header: string | null): ServerTiming {
  const metrics = new Map<string, number>()
  for (const entry of (header ?? '').split(',')) {
    const [name, ...params] = entry.trim().split(';')
    const duration = params.map((param) => param.trim()).find((param) => param.startsWith('dur='))
    const value = duration ? Number(duration.slice('dur='.length)) : Number.NaN
    if (name && Number.isFinite(value)) metrics.set(name.trim(), value)
  }
  return { sqlMs: metrics.get('sql') ?? null, contentMs: metrics.get('content') ?? null }
}

export function filterDimensions(body: Pick<SearchBody, 'filters' | 'annotationFilters'>, extra: { kinds?: boolean; project?: boolean } = {}): string[] {
  const filters = body.filters ?? {}
  const set = (Object.keys(filters) as (keyof DocumentFilters)[]).filter((key) => {
    const value = filters[key]
    return value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0)
  })
  return [
    ...set,
    ...(body.annotationFilters && Object.keys(body.annotationFilters).length > 0 ? ['annotation'] : []),
    ...(extra.kinds ? ['kind'] : []),
    ...(extra.project ? ['project'] : []),
  ].sort()
}

export function refinements(before: readonly string[], after: readonly string[]): Array<{ change: 'added' | 'removed'; dimension: string }> {
  const had = new Set(before)
  const has = new Set(after)
  return [
    ...after.filter((dimension) => !had.has(dimension)).map((dimension) => ({ change: 'added' as const, dimension })),
    ...before.filter((dimension) => !has.has(dimension)).map((dimension) => ({ change: 'removed' as const, dimension })),
  ]
}

export interface IssuedSearch {
  scope: SearchScopeQuery
  body: SearchBody
  response: SearchResponse
  durationMs: number
  serverTiming: ServerTiming
  view: 'list' | 'register'
  extraDimensions?: { kinds?: boolean; project?: boolean }
}

type Properties = Record<string, string | number | boolean | null>

export function newSearchId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
}

export function searchIssuedProperties(surface: SearchTelemetrySurface, issued: IssuedSearch, searchId: string | null = null): Properties {
  const text = issued.body.text?.trim() ?? ''
  const sections = Object.values(issued.response.sections)
  const total = sections.reduce((sum, section) => sum + (section?.total ?? 0), 0)
  return {
    surface,
    session_source: 'ui',
    scope: issued.response.scope.kind,
    has_text: text !== '',
    text_tokens: text === '' ? 0 : text.split(/\s+/).length,
    kinds: issued.body.kinds ? [...issued.body.kinds].sort().join(',') : 'all',
    filter_dims: filterDimensions(issued.body, issued.extraDimensions).join(','),
    view: issued.view,
    search_id: searchId,
    result_count: total,
    results_total: total,
    zero_results: total === 0,
    content_partial: issued.response.contentPartial,
    building: issued.response.building.length,
    duration_ms: Math.round(issued.durationMs),
    sql_ms: issued.serverTiming.sqlMs === null ? null : Math.round(issued.serverTiming.sqlMs),
    content_ms: issued.serverTiming.contentMs === null ? null : Math.round(issued.serverTiming.contentMs),
  }
}

export function searchResultOpenedProperties(surface: SearchTelemetrySurface, hit: SearchHit, rank: number, msSinceIssued: number | null, searchId: string | null = null): Properties {
  return {
    surface,
    search_id: searchId,
    kind: hit.kind,
    rank,
    matched_on: hit.kind === 'document' ? [...hit.matchedOn].sort().join(',') : null,
    has_passage: hit.kind === 'document' && hit.passage !== null,
    ms_since_issued: msSinceIssued === null ? null : Math.round(msSinceIssued),
  }
}

function hitKeyOf(href: string): string {
  const [base, hash = ''] = href.split('#')
  const [pathname, search = ''] = base.split('?')
  const params = new URLSearchParams(search)
  params.delete(BACK_PARAM)
  params.sort()
  return `${pathname}?${params.toString()}#${hash}`
}

export function findHitByHref(
  sections: Partial<Record<SearchKind, { hits: readonly SearchHit[] }>>,
  href: string,
  hrefOf: (hit: SearchHit) => string
): { hit: SearchHit; rank: number } | null {
  const key = hitKeyOf(href)
  for (const section of Object.values(sections)) {
    const at = section?.hits.findIndex((hit) => hitKeyOf(hrefOf(hit)) === key) ?? -1
    if (section && at >= 0) return { hit: section.hits[at], rank: at + 1 }
  }
  return null
}

export interface SearchTrackerOptions {
  capture?: (event: PostHogEvent, properties: Properties) => void
  settleMs?: number
  now?: () => number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export class SearchTracker {
  private pending: { issued: IssuedSearch; searchId: string; timer: unknown } | null = null
  private issuedAt: number | null = null
  private searchId: string | null = null
  private readonly capture: NonNullable<SearchTrackerOptions['capture']>
  private readonly settleMs: number
  private readonly now: () => number
  private readonly setTimer: NonNullable<SearchTrackerOptions['setTimer']>
  private readonly clearTimer: NonNullable<SearchTrackerOptions['clearTimer']>

  constructor(
    private readonly surface: SearchTelemetrySurface,
    options: SearchTrackerOptions = {}
  ) {
    this.capture = options.capture ?? capturePosthog
    this.settleMs = options.settleMs ?? SEARCH_SETTLE_MS
    this.now = options.now ?? (() => performance.now())
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  }

  answered(issued: IssuedSearch): void {
    if (this.pending) this.clearTimer(this.pending.timer)
    this.issuedAt = this.now()
    this.searchId = newSearchId()
    this.pending = { issued, searchId: this.searchId, timer: this.setTimer(() => this.flush(), this.settleMs) }
  }

  opened(hit: SearchHit, rank: number): void {
    this.flush()
    this.capture('search_result_opened', searchResultOpenedProperties(this.surface, hit, rank, this.issuedAt === null ? null : this.now() - this.issuedAt, this.searchId))
  }

  flush(): void {
    if (!this.pending) return
    this.clearTimer(this.pending.timer)
    const { issued, searchId } = this.pending
    this.pending = null
    this.capture('search_issued', searchIssuedProperties(this.surface, issued, searchId))
  }
}

export function captureRefinements(before: readonly string[], after: readonly string[], capture: SearchTrackerOptions['capture'] = capturePosthog): void {
  for (const refinement of refinements(before, after)) capture('search_refined', refinement)
}

export function savedSearchProperties(item: { shared: boolean; scope: SearchScopeQuery }): Properties {
  return { shared: item.shared, scope: item.scope.scope ?? (item.scope.projectId ? 'project' : 'office') }
}

export function captureSavedSearchRun(item: { shared: boolean; scope: SearchScopeQuery }): void {
  capturePosthog('saved_search_run', savedSearchProperties(item))
}

export function suggestionPickedProperties(dimension: SuggestDimension, rank: number, prefix: string): Properties {
  return { dimension, rank, prefix_chars: prefix.trim().length }
}

export function captureSuggestionPicked(dimension: SuggestDimension, rank: number, prefix: string): void {
  capturePosthog('search_suggestion_picked', suggestionPickedProperties(dimension, rank, prefix))
}

export function captureSavedSearchCreated(item: { shared: boolean; scope: SearchScopeQuery }): void {
  capturePosthog('saved_search_created', savedSearchProperties(item))
}
