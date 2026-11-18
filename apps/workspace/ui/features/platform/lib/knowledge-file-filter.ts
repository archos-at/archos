import { DOC_CLASSES, isOibBinding, resolveDocClass, type DocClass } from '@/lib/knowledge/doc-class'
import type { KnowledgeFile, KnowledgeFileState } from '@/lib/knowledge/service'

export const ALL = 'all'

const STATE_ORDER: KnowledgeFileState[] = [
  'failed',
  'inconsistent',
  'stale',
  'pending',
  'ingested',
  'removed',
]

const ATTENTION_STATES: ReadonlySet<KnowledgeFileState> = new Set([
  'failed',
  'inconsistent',
  'stale',
  'removed',
])
export const REINGESTABLE_STATES: ReadonlySet<KnowledgeFileState> = new Set([
  'failed',
  'inconsistent',
  'stale',
])

export type SortKey = 'document' | 'class' | 'state' | 'chunks'
export type SortDir = 'asc' | 'desc'
export type TypeFilter = typeof ALL | 'binding' | 'other' | DocClass
export type StateFilter = typeof ALL | 'issues' | 'pending'

export function filterAndSortKnowledgeFiles(
  files: readonly KnowledgeFile[],
  view: {
    query: string
    typeFilter: TypeFilter
    stateFilter: StateFilter
    sortKey: SortKey
    sortDir: SortDir
  },
  placement: { compare: (left: string, right: string) => number }
): KnowledgeFile[] {
  const { query, typeFilter, stateFilter, sortKey, sortDir } = view
  const needle = query.trim().toLowerCase()
  const matched = files.filter((f) => {
    if (typeFilter === 'binding' && !isOibBinding(f.docClass)) return false
    if (typeFilter === 'other' && isOibBinding(f.docClass)) return false
    if (typeFilter !== ALL && typeFilter !== 'binding' && typeFilter !== 'other') {
      if (resolveDocClass(f.docClass) !== typeFilter) return false
    }
    if (stateFilter === 'issues' && !ATTENTION_STATES.has(f.state)) return false
    if (stateFilter === 'pending' && f.state !== 'pending') return false
    if (needle && !`${f.fileName} ${f.displayTitle ?? ''}`.toLowerCase().includes(needle))
      return false
    return true
  })

  const direction = sortDir === 'asc' ? 1 : -1
  const rank = (f: KnowledgeFile): number | string => {
    switch (sortKey) {
      case 'document':
        return (f.displayTitle ?? f.fileName).toLowerCase()
      case 'class':
        return DOC_CLASSES.indexOf(resolveDocClass(f.docClass))
      case 'state':
        return STATE_ORDER.indexOf(f.state)
      case 'chunks':
        return f.chunkCount
    }
  }
  return [...matched].sort((a, b) => {
    const group = placement.compare(a.fileName, b.fileName)
    if (group !== 0) return group
    const left = rank(a)
    const right = rank(b)
    if (left < right) return -1 * direction
    if (left > right) return 1 * direction
    return a.fileName.localeCompare(b.fileName)
  })
}
