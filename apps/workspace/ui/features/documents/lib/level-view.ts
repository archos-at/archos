import type { DocumentReadFamily } from '@/lib/documents/document-status'
import type { DocumentLevelSort } from '@/lib/documents/list-cursor'
import type { FileFilters, FileStatusGroup } from './file-filters'
import type { FileSort } from './file-sort'

export const LEVEL_SEARCH_DEBOUNCE_MS = 250

export function levelSortOf(sort: FileSort): DocumentLevelSort | null {
  switch (sort.key) {
    case 'added':
    case 'name':
    case 'size':
      return sort.key
    case 'status':
    case 'relevance':
      return null
  }
}

const FAMILY_OF_GROUP: Record<FileStatusGroup, DocumentReadFamily> = {
  ready: 'readable',
  processing: 'reading',
  failed: 'failed',
}

export function readFamiliesOf(groups: readonly FileStatusGroup[]): DocumentReadFamily[] {
  return groups.map((group) => FAMILY_OF_GROUP[group])
}

export function filtersNeedWholeShelf(filters: FileFilters, canCollaborate: boolean): boolean {
  return (
    (canCollaborate && filters.assignment !== 'all') ||
    filters.reviewPendingOnly ||
    filters.kinds.length > 0 ||
    filters.tags.length > 0
  )
}

export function readsWholeShelf(filters: FileFilters, sort: FileSort, canCollaborate: boolean): boolean {
  return levelSortOf(sort) === null || filtersNeedWholeShelf(filters, canCollaborate)
}
