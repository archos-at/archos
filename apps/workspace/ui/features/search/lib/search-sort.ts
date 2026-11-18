import type { SearchSort } from '@/lib/search/search-wire'
import type { SearchUrlState, SortDirection } from './search-url'

export const REGISTER_COLUMNS = [
  'planNumber',
  'planIndex',
  'title',
  'planDate',
  'scale',
  'documentType',
  'author',
  'project',
  'folder',
  'uploaded',
  'pages',
  'status',
] as const
export type RegisterColumn = (typeof REGISTER_COLUMNS)[number]

export const DEFAULT_REGISTER_COLUMNS: readonly RegisterColumn[] = [
  'planNumber',
  'planIndex',
  'title',
  'planDate',
  'scale',
  'documentType',
  'author',
  'project',
]

export const FIXED_REGISTER_COLUMN: RegisterColumn = 'title'

export const COLUMN_SORT: Readonly<Record<RegisterColumn, SearchSort>> = {
  planNumber: 'plan_number',
  planIndex: 'plan_index',
  planDate: 'plan_date',
  scale: 'scale',
  title: 'name',
  documentType: 'document_type',
  author: 'author',
  project: 'project',
  folder: 'folder',
  uploaded: 'added',
  pages: 'page_count',
  status: 'status',
}

export function visibleRegisterColumns(columns: readonly RegisterColumn[] | null, options: { hideProject?: boolean } = {}): RegisterColumn[] {
  const chosen = new Set<RegisterColumn>(columns ?? DEFAULT_REGISTER_COLUMNS)
  chosen.add(FIXED_REGISTER_COLUMN)
  return REGISTER_COLUMNS.filter((column) => chosen.has(column) && !(options.hideProject && column === 'project'))
}

export function toggleRegisterColumn(columns: readonly RegisterColumn[] | null, column: RegisterColumn): RegisterColumn[] | null {
  if (column === FIXED_REGISTER_COLUMN) return columns === null ? null : [...columns]
  const chosen = new Set<RegisterColumn>(columns ?? DEFAULT_REGISTER_COLUMNS)
  if (chosen.has(column)) chosen.delete(column)
  else chosen.add(column)
  chosen.add(FIXED_REGISTER_COLUMN)
  return normalizeRegisterColumns(REGISTER_COLUMNS.filter((entry) => chosen.has(entry)))
}

export function normalizeRegisterColumns(columns: readonly RegisterColumn[] | null): RegisterColumn[] | null {
  if (columns === null) return null
  const chosen = new Set<RegisterColumn>(columns)
  chosen.add(FIXED_REGISTER_COLUMN)
  const ordered = REGISTER_COLUMNS.filter((column) => chosen.has(column))
  const isDefault = ordered.length === DEFAULT_REGISTER_COLUMNS.length && DEFAULT_REGISTER_COLUMNS.every((column) => chosen.has(column))
  return isDefault ? null : ordered
}

export function defaultDirection(sort: SearchSort): SortDirection {
  switch (sort) {
    case 'name':
    case 'plan_number':
    case 'plan_index':
    case 'document_type':
    case 'project':
    case 'scale':
    case 'folder':
    case 'status':
    case 'author':
      return 'asc'
    default:
      return 'desc'
  }
}

export function effectiveSort(state: Pick<SearchUrlState, 'sort' | 'dir' | 'text' | 'view'>): { sort: SearchSort; dir: SortDirection } {
  const hasText = state.text.trim() !== ''
  const fallback: SearchSort = hasText ? 'relevance' : state.view === 'register' ? 'plan_number' : 'added'
  const sort = state.sort === null || (state.sort === 'relevance' && !hasText) ? fallback : state.sort
  return { sort, dir: state.dir ?? defaultDirection(sort) }
}

type SortState = Pick<SearchUrlState, 'sort' | 'dir' | 'text' | 'view'>

export function columnSortState(state: SortState, column: RegisterColumn): SortDirection | null {
  const current = effectiveSort(state)
  return current.sort === COLUMN_SORT[column] ? current.dir : null
}

export function sortByColumn<T extends SortState>(state: T, column: RegisterColumn): T {
  const sort = COLUMN_SORT[column]
  const active = columnSortState(state, column)
  const dir: SortDirection = active === null ? defaultDirection(sort) : active === 'asc' ? 'desc' : 'asc'
  return { ...state, sort, dir }
}
