import { inferDocumentKind, type DocumentKind } from '../document-kind'
import type { FileItem } from '../components/project-file-workspace'
import { readStateOf } from './folder-knowledge'

export type AssignmentFilter = 'all' | 'mine' | 'unassigned'

export type FileStatusGroup = 'failed' | 'processing' | 'ready'

export const FILE_STATUS_GROUPS: readonly FileStatusGroup[] = ['failed', 'processing', 'ready']

export function statusGroupOf(status: string | null | undefined): FileStatusGroup | null {
  switch (readStateOf(status)) {
    case 'readable':
      return 'ready'
    case 'reading':
      return 'processing'
    case 'failed':
      return 'failed'
    case 'held':
    case 'unindexed':
      return null
  }
}

export const FILE_KIND_FILTERS: readonly DocumentKind[] = [
  'floorplan',
  'section',
  'siteplan',
  'notice',
  'photo',
  'model',
  'sheet',
  'text',
  'document',
]

export interface FileFilters {
  assignment: AssignmentFilter
  agentAuthoredOnly: boolean
  reviewPendingOnly: boolean
  includeArchived: boolean
  showOlderRevisions: boolean
  kinds: readonly DocumentKind[]
  statuses: readonly FileStatusGroup[]
  tags: readonly string[]
}

export interface TagOption {
  key: string
  label: string
  count: number
}

export function tagOptions(
  files: readonly FileItem[],
  locale: string,
  labelOf: (tag: string) => string = (tag) => tag
): TagOption[] {
  const counts = new Map<string, TagOption>()
  for (const file of files) {
    for (const tag of new Set([...(file.tags ?? []), ...(file.topics ?? [])])) {
      const key = tag.toLowerCase()
      const entry = counts.get(key)
      if (entry) entry.count += 1
      else counts.set(key, { key, label: labelOf(tag), count: 1 })
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, locale)
  )
}

export const NO_FILE_FILTERS: FileFilters = {
  assignment: 'all',
  agentAuthoredOnly: false,
  reviewPendingOnly: false,
  includeArchived: false,
  showOlderRevisions: false,
  kinds: [],
  statuses: [],
  tags: [],
}

export function activeFilterCount(filters: FileFilters, canCollaborate: boolean): number {
  let count = 0
  if (canCollaborate && filters.assignment !== 'all') count += 1
  if (filters.agentAuthoredOnly) count += 1
  if (filters.reviewPendingOnly) count += 1
  if (filters.includeArchived) count += 1
  if (filters.showOlderRevisions) count += 1
  if (filters.kinds.length > 0) count += 1
  if (filters.statuses.length > 0) count += 1
  if (filters.tags.length > 0) count += 1
  return count
}

export function toggleIn<T>(values: readonly T[], value: T, order: readonly T[]): T[] {
  const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
  return order.filter((candidate) => next.includes(candidate))
}

export interface FileFilterContext {
  canCollaborate: boolean
  currentUserId?: string
}

export function applyFileFilters<T extends FileItem>(
  files: readonly T[],
  filters: FileFilters,
  { canCollaborate, currentUserId }: FileFilterContext
): readonly T[] {
  const assignment = canCollaborate ? filters.assignment : 'all'
  const constrained =
    assignment !== 'all' ||
    filters.reviewPendingOnly ||
    filters.kinds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.tags.length > 0
  if (!constrained) return files

  return files.filter((file) => {
    if (assignment === 'unassigned' && (file.assignees?.length ?? 0) > 0) return false
    if (
      assignment === 'mine' &&
      !file.assignees?.some((person) => person.userId === currentUserId)
    ) {
      return false
    }
    if (filters.statuses.length > 0) {
      const group = statusGroupOf(file.status)
      if (group === null || !filters.statuses.includes(group)) return false
    }
    if (
      filters.tags.length > 0 &&
      ![...(file.tags ?? []), ...(file.topics ?? [])].some((tag) => filters.tags.includes(tag.toLowerCase()))
    ) {
      return false
    }
    if (filters.reviewPendingOnly && file.versionState !== 'in_review') return false
    if (filters.kinds.length > 0) {
      const kind = inferDocumentKind({
        filename: file.filename,
        contentType: file.contentType,
        tags: file.tags,
      })
      if (!filters.kinds.includes(kind)) return false
    }
    return true
  })
}
