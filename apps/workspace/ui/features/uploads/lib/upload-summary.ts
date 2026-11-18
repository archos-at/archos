import type { UploadHistoryEntry, UploadSummary, UploadSummaryDocument } from '@/adapters/api/upload-batches-client'
import { documentFilesHref } from '@/features/documents/lib/document-question'
import { documentTypeOf } from '@/lib/documents/tag-vocabulary'

export const TALLY_KEYS = ['ready', 'reading', 'quarantined', 'failed', 'stored', 'unchanged', 'excluded'] as const
export type TallyKey = (typeof TALLY_KEYS)[number]
export type UploadTally = Record<TallyKey, number>

export function tallySummary(summary: UploadSummary): UploadTally {
  const tally: UploadTally = {
    ready: 0,
    reading: 0,
    quarantined: 0,
    failed: summary.failedCount,
    stored: 0,
    unchanged: summary.unchangedCount,
    excluded: summary.excluded.reduce((sum, entry) => sum + entry.count, 0),
  }
  for (const document of summary.documents) tally[document.outcome] += 1
  return tally
}

export function tallyHistoryEntry(entry: UploadHistoryEntry): UploadTally {
  return {
    ...entry.counts,
    failed: entry.counts.failed + entry.failedCount,
    unchanged: entry.unchangedCount,
    excluded: entry.excludedCount,
  }
}

export function visibleTally(tally: UploadTally): Array<{ key: TallyKey; count: number }> {
  return TALLY_KEYS.filter((key) => key === 'ready' || tally[key] > 0).map((key) => ({ key, count: tally[key] }))
}

export const FACET_KEYS = ['changed', 'protected'] as const
export type FacetKey = (typeof FACET_KEYS)[number]

export type CountKey = TallyKey | FacetKey

export function summaryFacets(summary: UploadSummary): Array<{ key: FacetKey; count: number }> {
  const counts: Record<FacetKey, number> = {
    changed: summary.documents.filter((document) => document.replaced).length,
    protected: summary.documents.filter((document) => document.restricted).length,
  }
  return FACET_KEYS.filter((key) => counts[key] > 0).map((key) => ({ key, count: counts[key] }))
}

export interface FolderGroup {
  path: string | null
  documents: UploadSummaryDocument[]
}

export function groupByFolder(documents: readonly UploadSummaryDocument[]): FolderGroup[] {
  const groups = new Map<string | null, UploadSummaryDocument[]>()
  for (const document of documents) {
    const path = document.folderPath?.trim() || null
    const group = groups.get(path) ?? []
    group.push(document)
    groups.set(path, group)
  }
  const byName = (a: UploadSummaryDocument, b: UploadSummaryDocument) =>
    displayNameOf(a).localeCompare(displayNameOf(b), 'de')
  return [...groups.entries()]
    .map(([path, docs]) => ({ path, documents: [...docs].sort(byName) }))
    .sort((a, b) => (a.path === null ? -1 : b.path === null ? 1 : a.path.localeCompare(b.path, 'de')))
}

export function formatFolderPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .join(' / ')
}

export function displayNameOf(document: Pick<UploadSummaryDocument, 'displayName' | 'filename'>): string {
  return document.displayName?.trim() || document.filename
}

export function documentTypeCounts(documents: readonly UploadSummaryDocument[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>()
  for (const document of documents) {
    const type = documentTypeOf(document.tags)
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, 'de'))
}

export function otherTags(tags: readonly string[]): string[] {
  const type = documentTypeOf(tags)
  return tags.filter((tag) => tag !== type)
}

export function isSettling(summary: UploadSummary): boolean {
  return summary.completedAt === null && summary.documents.some((document) => document.outcome === 'reading')
}

export function documentHref(summary: Pick<UploadSummary, 'scope' | 'projectId'>, documentId: string): string | null {
  if (summary.scope === 'office_shelf') return `/app/office-shelf?doc=${encodeURIComponent(documentId)}`
  return summary.scope === 'project' && summary.projectId ? documentFilesHref(summary.projectId, documentId) : null
}

export function placeHref(summary: Pick<UploadSummary, 'scope' | 'projectId' | 'conversationId'>): string | null {
  if (summary.scope === 'office_shelf') return '/app/office-shelf'
  if (summary.scope === 'session') {
    return summary.conversationId ? `/app/chat?session=${encodeURIComponent(summary.conversationId)}` : null
  }
  return summary.projectId ? `/app/projects/${encodeURIComponent(summary.projectId)}/files` : null
}
