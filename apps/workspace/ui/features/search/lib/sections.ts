import type { SearchHit, SearchKind, SearchResponse, SearchSection } from '@/lib/search/search-wire'

export interface SectionView<T extends SearchHit = SearchHit> {
  hits: T[]
  total: number
  totalIsLowerBound: boolean
  nextCursor: string | null
  loadingMore: boolean
  loadMoreFailed: boolean
}

export function sectionView(section: SearchSection): SectionView {
  return { ...section, loadingMore: false, loadMoreFailed: false }
}

export function kindCountsKnown(response: Pick<SearchResponse, 'sections' | 'setAside'> | null, kinds: readonly SearchKind[]): boolean {
  if (!response) return false
  return kinds.every((kind) => response.setAside[kind] !== undefined || response.sections[kind] !== undefined)
}
