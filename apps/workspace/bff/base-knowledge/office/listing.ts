/**
 * How the office's entries are narrowed for a list: by folder (with its
 * subfolders), by what needs attention, by kind and by a search over the
 * designation, title and file name. Pure, over entries the service has already
 * read for the session, so the counts and the page come from one read.
 */

import type { BaseKnowledgeEntry, EntryAttention, EntryCounts, ListEntriesQuery } from '../wire'

/** Whether an entry needs this kind of attention. */
export function needs(entry: BaseKnowledgeEntry, attention: EntryAttention): boolean {
  if (attention === 'proposed') return entry.status === 'proposed'
  if (attention === 'metadata_only') return entry.status === 'confirmed' && entry.textUse === 'metadata_only'
  return entry.status === 'confirmed' && entry.freshness.overdue
}

export function countEntries(entries: readonly BaseKnowledgeEntry[]): EntryCounts {
  return {
    all: entries.length,
    proposed: entries.filter((entry) => needs(entry, 'proposed')).length,
    checkDue: entries.filter((entry) => needs(entry, 'check_due')).length,
    metadataOnly: entries.filter((entry) => needs(entry, 'metadata_only')).length,
  }
}

/** A folder and every folder below it, from the parent links. */
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

/** The entries the query's filters keep, other than the folder (the caller narrows that before counting). */
export function matchesQuery(entry: BaseKnowledgeEntry, query: Partial<ListEntriesQuery>): boolean {
  if (query.status && entry.status !== query.status) return false
  if (query.kind && entry.values.kind !== query.kind) return false
  if (query.attention && !needs(entry, query.attention)) return false
  if (query.designation && !searched(entry, query.designation)) return false
  return !query.q || searched(entry, query.q)
}

/**
 * The order a list reads in: what needs a person first (proposals, then checks
 * due), then by designation or title.
 */
export function byAttention(a: BaseKnowledgeEntry, b: BaseKnowledgeEntry): number {
  const rank = (entry: BaseKnowledgeEntry) => (needs(entry, 'proposed') ? 0 : needs(entry, 'check_due') ? 1 : 2)
  const label = (entry: BaseKnowledgeEntry) => entry.values.designation ?? entry.values.title
  return rank(a) - rank(b) || label(a).localeCompare(label(b), 'de', { numeric: true })
}
