import { DOSSIER_DOCUMENT_TYPES, DOSSIER_FACT_KEYS, DOSSIER_PARTY_ROLES, type DossierFactKey } from '@/lib/documents/dossier'
import { ALLOWED_TAGS } from '@/lib/documents/tag-vocabulary'
import {
  SEARCH_KINDS,
  SEARCH_READ_STATES,
  SEARCH_SORTS,
  type DocumentFilters,
  type FactFilter,
  type SearchBody,
  type SearchKind,
  type SearchSort,
} from '@/lib/search/search-wire'
import { effectiveSort, normalizeRegisterColumns, REGISTER_COLUMNS, type RegisterColumn } from './search-sort'

export const SEARCH_VIEWS = ['list', 'register'] as const
export type SearchView = (typeof SEARCH_VIEWS)[number]

export type SortDirection = 'asc' | 'desc'

export interface SearchUrlState {
  text: string
  view: SearchView
  kinds: SearchKind[] | null
  sort: SearchSort | null
  dir: SortDirection | null
  filters: DocumentFilters
  projectId: string | null
  columns: RegisterColumn[] | null
}

export const EMPTY_SEARCH_STATE: SearchUrlState = {
  text: '',
  view: 'list',
  kinds: null,
  sort: null,
  dir: null,
  filters: {},
  projectId: null,
  columns: null,
}

export const SEARCH_PARAMS = {
  text: 'q',
  view: 'view',
  kind: 'kind',
  sort: 'sort',
  dir: 'dir',
  documentType: 'type',
  tag: 'tag',
  planNumber: 'plan',
  planIndex: 'index',
  planFrom: 'planFrom',
  planTo: 'planTo',
  scale: 'scale',
  current: 'current',
  party: 'party',
  place: 'place',
  fact: 'fact',
  cites: 'cites',
  uploadedFrom: 'upFrom',
  uploadedTo: 'upTo',
  uploader: 'uploader',
  state: 'state',
  incomplete: 'incomplete',
  changed: 'changed',
  changedFact: 'changedFact',
  fileType: 'ext',
  pagesMin: 'pagesMin',
  pagesMax: 'pagesMax',
  archived: 'archived',
  project: 'project',
  columns: 'cols',
} as const

const ALL_SEARCH_PARAM_NAMES: readonly string[] = Object.values(SEARCH_PARAMS)

export const NUMERIC_FACT_KEYS: ReadonlySet<DossierFactKey> = new Set<DossierFactKey>([
  'storeys_above_ground',
  'storeys_below_ground',
  'building_height',
  'gross_floor_area',
  'usable_floor_area',
  'plot_area',
  'floor_area_ratio',
  'site_coverage_ratio',
  'units',
  'parking_spaces',
  'escape_route_length',
  'room_height',
  'heating_demand',
])

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXTENSION = /^[a-z0-9]{1,8}$/
const SHORT_TEXT_MAX = 120

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null
}

function shortText(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? undefined : trimmed.slice(0, SHORT_TEXT_MAX)
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function list<T extends string>(params: URLSearchParams, name: string, accept: (value: string) => T | null, max: number): T[] | undefined {
  const values = unique(params.getAll(name).flatMap((value) => {
    const accepted = accept(value.trim())
    return accepted === null ? [] : [accepted]
  })).slice(0, max)
  return values.length > 0 ? values : undefined
}

function day(value: string | null): string | undefined {
  return value !== null && ISO_DAY.test(value) ? value : undefined
}

function range(from: string | undefined, to: string | undefined): { from?: string; to?: string } | undefined {
  if (from === undefined && to === undefined) return undefined
  return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }
}

function count(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value)) return undefined
  return Number(value)
}

function finite(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function parseFactParam(value: string): FactFilter | null {
  const equals = /^([a-z_]+)=(.+)$/.exec(value)
  if (equals) {
    const key = oneOf(DOSSIER_FACT_KEYS, equals[1])
    const text = shortText(equals[2])
    return key && text ? { key, equals: text } : null
  }
  const between = /^([a-z_]+):([^.]*(?:\.[^.]+)?)\.\.(.*)$/.exec(value)
  if (!between) return null
  const key = oneOf(DOSSIER_FACT_KEYS, between[1])
  const min = finite(between[2])
  const max = finite(between[3])
  if (!key || (min === undefined && max === undefined)) return null
  return { key, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
}

export function writeFactParam(fact: FactFilter): string {
  if (fact.equals !== undefined) return `${fact.key}=${fact.equals}`
  return `${fact.key}:${fact.min ?? ''}..${fact.max ?? ''}`
}

type PartyFilter = NonNullable<DocumentFilters['parties']>[number]

export function parsePartyParam(value: string): PartyFilter | null {
  const colon = value.indexOf(':')
  const rolePart = colon === -1 ? value : value.slice(0, colon)
  const namePart = colon === -1 ? '' : value.slice(colon + 1)
  const role = oneOf(DOSSIER_PARTY_ROLES, rolePart.trim() || null)
  const name = shortText(namePart)
  if (!role && !name) return null
  return { ...(role ? { role } : {}), ...(name ? { name } : {}) }
}

export function writePartyParam(party: PartyFilter): string {
  return `${party.role ?? ''}:${party.name ?? ''}`
}

export function compactFilters(filters: DocumentFilters): DocumentFilters {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out as DocumentFilters
}

export function parseSearchParams(params: URLSearchParams): SearchUrlState {
  const P = SEARCH_PARAMS
  const text = (params.get(P.text) ?? '').slice(0, 500)
  const view = oneOf(SEARCH_VIEWS, params.get(P.view)) ?? 'list'
  const kinds = list(params, P.kind, (value) => oneOf(SEARCH_KINDS, value), SEARCH_KINDS.length) ?? null
  const sort = oneOf(SEARCH_SORTS, params.get(P.sort))
  const dir = oneOf(['asc', 'desc'] as const, params.get(P.dir))
  const project = params.get(P.project)
  const pagesMin = count(params.get(P.pagesMin))
  const pagesMax = count(params.get(P.pagesMax))
  const current = params.get(P.current)

  const filters = compactFilters({
    documentTypes: list(params, P.documentType, (value) => oneOf(DOSSIER_DOCUMENT_TYPES, value), 24),
    tags: list(params, P.tag, (value) => (ALLOWED_TAGS.has(value) ? value : null), 20),
    planNumber: shortText(params.get(P.planNumber)),
    planIndex: list(params, P.planIndex, (value) => shortText(value) ?? null, 20),
    planDate: range(day(params.get(P.planFrom)), day(params.get(P.planTo))),
    scale: list(params, P.scale, (value) => shortText(value) ?? null, 20),
    currentOnly: (view === 'register' ? current !== '0' : current === '1') ? true : undefined,
    parties: (() => {
      const parties = params.getAll(P.party).flatMap((value) => {
        const party = parsePartyParam(value)
        return party ? [party] : []
      })
      return parties.length > 0 ? parties.slice(0, 8) : undefined
    })(),
    place: shortText(params.get(P.place)),
    facts: (() => {
      const facts = params.getAll(P.fact).flatMap((value) => {
        const fact = parseFactParam(value)
        return fact ? [fact] : []
      })
      return facts.length > 0 ? facts.slice(0, 8) : undefined
    })(),
    cites: list(params, P.cites, (value) => shortText(value) ?? null, 8),
    uploaded: range(day(params.get(P.uploadedFrom)), day(params.get(P.uploadedTo))),
    uploadedBy: list(params, P.uploader, (value) => (value !== '' && value.length <= 100 ? value : null), 20),
    states: list(params, P.state, (value) => oneOf(SEARCH_READ_STATES, value), SEARCH_READ_STATES.length),
    incompleteRead: params.get(P.incomplete) === '1' ? true : undefined,
    factsChanged: params.get(P.changed) === '1' ? true : undefined,
    changedFacts: list(params, P.changedFact, (value) => oneOf(DOSSIER_FACT_KEYS, value), DOSSIER_FACT_KEYS.length),
    fileTypes: list(params, P.fileType, (value) => (EXTENSION.test(value.toLowerCase()) ? value.toLowerCase() : null), 12),
    pages:
      pagesMin !== undefined || pagesMax !== undefined
        ? { ...(pagesMin !== undefined ? { min: pagesMin } : {}), ...(pagesMax !== undefined ? { max: pagesMax } : {}) }
        : undefined,
    includeArchived: params.get(P.archived) === '1' ? true : undefined,
  })

  return {
    text,
    view,
    kinds,
    sort,
    dir,
    filters,
    projectId: project !== null && UUID.test(project) ? project : null,
    columns: parseColumnsParam(params.get(P.columns)),
  }
}

export function parseColumnsParam(value: string | null): RegisterColumn[] | null {
  if (value === null) return null
  const named = value.split(',').flatMap((entry) => {
    const column = oneOf(REGISTER_COLUMNS, entry.trim())
    return column ? [column] : []
  })
  return named.length > 0 ? normalizeRegisterColumns(named) : null
}

export function currentOnlyDefault(view: SearchView): boolean {
  return view === 'register'
}

export function withView(state: SearchUrlState, view: SearchView): SearchUrlState {
  if (view === state.view) return state
  const current = Boolean(state.filters.currentOnly)
  const currentOnly = current === currentOnlyDefault(state.view) ? currentOnlyDefault(view) : current
  return { ...state, view, filters: compactFilters({ ...state.filters, currentOnly: currentOnly || undefined }) }
}

export function writeSearchParams(state: SearchUrlState, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const P = SEARCH_PARAMS
  const params = new URLSearchParams(base.toString())
  for (const name of ALL_SEARCH_PARAM_NAMES) params.delete(name)
  const set = (name: string, value: string | number | undefined | null): void => {
    if (value !== undefined && value !== null && value !== '') params.set(name, String(value))
  }
  const add = (name: string, values: readonly string[] | undefined): void => {
    for (const value of values ?? []) params.append(name, value)
  }
  const f = state.filters

  set(P.text, state.text.trim() === '' ? undefined : state.text)
  if (state.view !== 'list') set(P.view, state.view)
  add(P.kind, state.kinds ?? undefined)
  set(P.sort, state.sort)
  set(P.dir, state.dir)
  set(P.project, state.projectId)
  add(P.documentType, f.documentTypes)
  add(P.tag, f.tags)
  set(P.planNumber, f.planNumber)
  add(P.planIndex, f.planIndex)
  set(P.planFrom, f.planDate?.from)
  set(P.planTo, f.planDate?.to)
  add(P.scale, f.scale)
  if (state.view === 'register') {
    if (!f.currentOnly) set(P.current, 0)
  } else if (f.currentOnly) set(P.current, 1)
  add(P.party, f.parties?.map(writePartyParam))
  set(P.place, f.place)
  add(P.fact, f.facts?.map(writeFactParam))
  add(P.cites, f.cites)
  set(P.uploadedFrom, f.uploaded?.from)
  set(P.uploadedTo, f.uploaded?.to)
  add(P.uploader, f.uploadedBy)
  add(P.state, f.states)
  if (f.incompleteRead) set(P.incomplete, 1)
  if (f.factsChanged) set(P.changed, 1)
  add(P.changedFact, f.changedFacts)
  add(P.fileType, f.fileTypes)
  set(P.pagesMin, f.pages?.min)
  set(P.pagesMax, f.pages?.max)
  if (f.includeArchived) set(P.archived, 1)
  const columns = normalizeRegisterColumns(state.columns)
  if (columns) set(P.columns, columns.join(','))
  return params
}

export function hasSearchParams(params: URLSearchParams): boolean {
  return ALL_SEARCH_PARAM_NAMES.some((name) => params.has(name))
}

export function withoutSearchParams(params: URLSearchParams): URLSearchParams {
  const kept = new URLSearchParams(params.toString())
  for (const name of ALL_SEARCH_PARAM_NAMES) kept.delete(name)
  return kept
}

export interface SearchBodyOptions {
  limit?: number
  cursor?: string
  kinds?: SearchKind[]
  facets?: boolean
}

export function toSearchBody(state: SearchUrlState, options: SearchBodyOptions = {}): SearchBody {
  const text = state.text.trim()
  const filters = compactFilters(state.filters)
  const kinds = options.kinds ?? (state.view === 'register' ? ['document' as const] : state.kinds ?? undefined)
  const order = state.view === 'register' ? effectiveSort(state) : null
  const sort = order && order.sort !== 'relevance' ? order.sort : state.sort === 'relevance' && text === '' ? null : state.sort
  const dir = order && order.sort !== 'relevance' ? order.dir : state.dir
  return {
    ...(text !== '' ? { text } : {}),
    ...(kinds ? { kinds } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(sort ? { sort } : {}),
    ...(sort && dir ? { dir } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    ...(options.facets !== undefined ? { facets: options.facets } : {}),
  }
}

export function fromSearchBody(body: SearchBody, projectId: string | null = null): SearchUrlState {
  const documentsOnly = body.kinds?.length === 1 && body.kinds[0] === 'document'
  const registerOrder = body.sort !== undefined && body.sort !== 'relevance'
  return {
    text: body.text ?? '',
    view: documentsOnly && registerOrder ? 'register' : 'list',
    kinds: documentsOnly && registerOrder ? null : body.kinds ?? null,
    sort: body.sort ?? null,
    dir: body.dir ?? null,
    filters: compactFilters(body.filters ?? {}),
    projectId,
    columns: null,
  }
}

export function activeFilterCount(state: SearchUrlState): number {
  let total = state.projectId ? 1 : 0
  for (const [key, value] of Object.entries(compactFilters(state.filters))) {
    if (key === 'currentOnly' && state.view === 'register') continue
    total += Array.isArray(value) ? value.length : 1
  }
  return total
}

const READ_FILTER_FIELDS: ReadonlyArray<keyof DocumentFilters> = [
  'documentTypes',
  'tags',
  'planNumber',
  'planIndex',
  'planDate',
  'scale',
  'currentOnly',
  'parties',
  'place',
  'municipalities',
  'facts',
  'cites',
  'citedBy',
  'citing',
  'documentDate',
]

export function filtersByReading(state: SearchUrlState): boolean {
  const f = compactFilters(state.filters)
  return READ_FILTER_FIELDS.some((field) => f[field] !== undefined)
}

export function officeSearchHref(state: SearchUrlState): string {
  const query = writeSearchParams({ ...state, projectId: null }).toString()
  return query ? `/app/search?${query}` : '/app/search'
}
