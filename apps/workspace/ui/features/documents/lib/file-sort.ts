import type { FileItem } from '../components/project-file-workspace'
import { documentDisplayName } from '@/lib/documents/display-name'
import { statusGroupOf, type FileStatusGroup } from './file-filters'

export type FileSortKey = 'name' | 'status' | 'size' | 'added' | 'relevance'

export type SortDirection = 'asc' | 'desc'

export interface FileSort {
  key: FileSortKey
  direction: SortDirection
}

const STATUS_GROUP_RANK: Record<FileStatusGroup, number> = {
  failed: 0,
  processing: 1,
  ready: 2,
}

const NO_GROUP_RANK = 3

const statusRank = (status: string | null): number => {
  const group = statusGroupOf(status)
  return group === null ? NO_GROUP_RANK : STATUS_GROUP_RANK[group]
}

export type RankedFile = FileItem & { rank?: number }

const rankOf = (file: RankedFile): number => file.rank ?? Number.MAX_SAFE_INTEGER

const timeOf = (iso: string): number => {
  const value = new Date(iso).getTime()
  return Number.isNaN(value) ? 0 : value
}

export function defaultDirectionFor(key: FileSortKey): SortDirection {
  return key === 'name' ? 'asc' : 'desc'
}

export const RELEVANCE_SORT: FileSort = { key: 'relevance', direction: 'desc' }

export const DEFAULT_FILE_SORT: FileSort = { key: 'added', direction: 'desc' }

export function nextSort(current: FileSort, key: FileSortKey): FileSort {
  if (current.key !== key) return { key, direction: defaultDirectionFor(key) }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

export function sortFiles<T extends RankedFile>(files: readonly T[], sort: FileSort, locale?: string): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  const sign = sort.direction === 'asc' ? 1 : -1

  const compare = (a: T, b: T): number => {
    switch (sort.key) {
      case 'name':
        return collator.compare(documentDisplayName(a), documentDisplayName(b))
      case 'status':
        return statusRank(a.status) - statusRank(b.status)
      case 'size':
        return (a.fileSize ?? 0) - (b.fileSize ?? 0)
      case 'added':
        return timeOf(a.createdAt) - timeOf(b.createdAt)
      case 'relevance':
        return rankOf(b) - rankOf(a)
    }
  }

  return [...files].sort((a, b) => {
    const primary = compare(a, b)
    if (primary !== 0) return primary * sign
    return collator.compare(a.filename, b.filename)
  })
}
