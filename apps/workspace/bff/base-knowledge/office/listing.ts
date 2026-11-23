import type { BaseKnowledgeEntry, EntryAttention, EntryCounts, EntryEdition, ListEntriesQuery } from '../wire'

export function editionReplaced(editions: readonly EntryEdition[], id: string): boolean {
  const own = editions.find((edition) => edition.id === id)
  if (!own || own.inForceToday) return false
  return editions.some((edition) => edition.inForceToday && (edition.startsOn ?? '') > (own.startsOn ?? ''))
}

export function isSuperseded(entry: BaseKnowledgeEntry): boolean {
  return entry.status === 'confirmed' && editionReplaced(entry.editions, entry.id)
}

export type EntryStand = 'proposed' | 'superseded' | 'current' | 'newer_edition' | 'checked' | 'check_due'

export function standFromBinding(entry: Pick<BaseKnowledgeEntry, 'binding'>): boolean {
  return entry.binding !== null && (entry.binding.held || entry.binding.newer)
}

export function standOf(entry: BaseKnowledgeEntry): EntryStand {
  if (entry.status === 'proposed') return 'proposed'
  if (isSuperseded(entry)) return 'superseded'
  if (entry.binding?.held) return 'current'
  if (entry.binding?.newer) return 'newer_edition'
  return entry.freshness.overdue ? 'check_due' : 'checked'
}

export function needs(entry: BaseKnowledgeEntry, attention: EntryAttention): boolean {
  if (attention === 'metadata_only') return entry.status === 'confirmed' && entry.textUse === 'metadata_only'
  return standOf(entry) === attention
}

export function countEntries(entries: readonly BaseKnowledgeEntry[]): EntryCounts {
  return {
    all: entries.length,
    proposed: entries.filter((entry) => needs(entry, 'proposed')).length,
    newerEdition: entries.filter((entry) => needs(entry, 'newer_edition')).length,
    checkDue: entries.filter((entry) => needs(entry, 'check_due')).length,
    metadataOnly: entries.filter((entry) => needs(entry, 'metadata_only')).length,
  }
}

export function subtreeOf(folderId: string, folders: readonly { id: string; parentId: string | null }[]): Set<string> {
  const subtree = new Set([folderId])
  let grew = true
  while (grew) {
    grew = false
    for (const folder of folders) {
      if (folder.parentId && subtree.has(folder.parentId) && !subtree.has(folder.id)) {
        subtree.add(folder.id)
        grew = true
      }
    }
  }
  return subtree
}

const fold = (text: string) => text.toLocaleLowerCase('de').normalize('NFC')

function searched(entry: BaseKnowledgeEntry, text: string): boolean {
  const wanted = fold(text)
  return [entry.values.designation, entry.values.title, entry.fileName].some((field) => field !== null && fold(field).includes(wanted))
}

export function matchesQuery(entry: BaseKnowledgeEntry, query: Partial<ListEntriesQuery>): boolean {
  if (query.status && entry.status !== query.status) return false
  if (query.kind && entry.values.kind !== query.kind) return false
  if (query.attention && !needs(entry, query.attention)) return false
  if (query.designation && !searched(entry, query.designation)) return false
  return !query.q || searched(entry, query.q)
}

export function byAttention(a: BaseKnowledgeEntry, b: BaseKnowledgeEntry): number {
  const ranks: Partial<Record<EntryStand, number>> = { proposed: 0, newer_edition: 1, check_due: 2 }
  const rank = (entry: BaseKnowledgeEntry) => ranks[standOf(entry)] ?? 3
  const label = (entry: BaseKnowledgeEntry) => entry.values.designation ?? entry.values.title
  return rank(a) - rank(b) || label(a).localeCompare(label(b), 'de', { numeric: true })
}

export function countByFolder(entries: readonly BaseKnowledgeEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) if (entry.folderId) counts[entry.folderId] = (counts[entry.folderId] ?? 0) + 1
  return counts
}
