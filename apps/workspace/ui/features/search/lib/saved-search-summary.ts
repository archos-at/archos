import type { SearchBody } from '@/lib/search/search-wire'
import { activeFilters, type ActiveFilter } from './active-filters'
import { fromSearchBody } from './search-url'

export interface SavedSearchSummaryWords {
  quote: (text: string) => string
  register: string
  filter: (filter: ActiveFilter) => string
  everything: string
}

const SEPARATOR = ' · '

export function savedSearchSummary(query: SearchBody, words: SavedSearchSummaryWords): string {
  const state = fromSearchBody(query)
  const text = state.text.trim()
  const parts = [
    ...(text ? [words.quote(text)] : []),
    ...(state.view === 'register' ? [words.register] : []),
    ...activeFilters(state).map(words.filter),
  ]
  return parts.length > 0 ? parts.join(SEPARATOR) : words.everything
}
