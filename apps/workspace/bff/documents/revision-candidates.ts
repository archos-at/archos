import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getProjectFolderAccess } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { collectionFileRef } from './collection-file-ref'
import type { DocumentReader } from './document-reader'
import { findRevisionSeriesRows, type RevisionSeriesRow } from './revision-candidates-repository'
import type { RevisionCandidateMatch } from './name-probe-types'
import { readRevisionLinkNames } from './reconcile-status'
import { findRevisionCandidate, parseRevisionName, revisionSeriesKeyOf } from './revision-series'
import { projectShelf, type DocumentShelf } from './shelf'
import { shelfCollectionName } from './shelf-collection'

export const REVISION_PROBE_MAX_SERIES = 200
const WORDS_PER_QUERY = 50
const MIN_WORD_LENGTH = 3

interface DroppedSeries {
  names: string[]
  word: string
}

function seriesOf(names: readonly string[]): Map<string, DroppedSeries> {
  const series = new Map<string, DroppedSeries>()
  for (const name of new Set(names)) {
    const key = revisionSeriesKeyOf(name)
    const revision = parseRevisionName(name)
    if (!key || !revision) continue
    const known = series.get(key)
    if (known) {
      known.names.push(name)
      continue
    }
    if (series.size >= REVISION_PROBE_MAX_SERIES) continue
    const word = (revision.key.match(/[a-z0-9]+/g) ?? []).reduce((longest, run) => (run.length > longest.length ? run : longest), '')
    if (word.length >= MIN_WORD_LENGTH) series.set(key, { names: [name], word })
  }
  return series
}

async function narrowedRows(
  shelf: DocumentShelf,
  organizationId: string,
  words: readonly string[],
  options: Pick<RevisionCandidateOptions, 'hiddenFolderIds' | 'reader'>,
): Promise<RevisionSeriesRow[]> {
  const byId = new Map<string, RevisionSeriesRow>()
  for (let start = 0; start < words.length; start += WORDS_PER_QUERY) {
    for (const row of await findRevisionSeriesRows(shelf, organizationId, words.slice(start, start + WORDS_PER_QUERY), options)) {
      byId.set(row.id, row)
    }
  }
  return [...byId.values()]
}

async function isReplaced(row: RevisionSeriesRow): Promise<boolean> {
  const ref = collectionFileRef(row)
  const names = ref ? await readRevisionLinkNames(ref) : null
  return Boolean(names?.supersededBy)
}

export interface RevisionCandidateOptions {
  hiddenFolderIds?: readonly string[]
  reader: DocumentReader
  collectionFor?: (name: string) => string
}

export async function revisionCandidatesOnShelf(
  shelf: DocumentShelf,
  organizationId: string,
  names: readonly string[],
  options: RevisionCandidateOptions,
): Promise<RevisionCandidateMatch[]> {
  const series = seriesOf(names)
  if (series.size === 0) return []
  const { collectionFor, ...query } = options
  const rows = await narrowedRows(shelf, organizationId, [...new Set([...series.values()].map((entry) => entry.word))], query)

  const bySeries = new Map<string, RevisionSeriesRow[]>()
  for (const row of rows) {
    const key = revisionSeriesKeyOf(row.filename)
    if (!key || !series.has(key)) continue
    bySeries.set(key, [...(bySeries.get(key) ?? []), row])
  }

  const matches: RevisionCandidateMatch[] = []
  for (const [key, dropped] of series) {
    const members = bySeries.get(key) ?? []
    const replaced = await Promise.all(members.map(isReplaced))
    const current = members
      .filter((_, index) => !replaced[index])
      .map((row) => ({ row, filename: row.filename, createdAt: row.createdAt ? row.createdAt.toISOString() : null }))
    if (current.length === 0) continue
    for (const name of dropped.names) {
      const collection = collectionFor?.(name)
      const reachable = collection === undefined ? current : current.filter((item) => item.row.collectionName === collection)
      if (reachable.length === 0) continue
      const candidate = findRevisionCandidate(name, reachable)
      if (!candidate) continue
      matches.push({
        name,
        candidates: candidate.candidates.map(({ item, label }) => ({
          id: item.row.id,
          filename: item.row.filename,
          displayName: item.row.displayName,
          label,
        })),
        newer: candidate.newer,
        unambiguous: candidate.unambiguous,
      })
    }
  }
  return matches
}

export async function probeProjectRevisionCandidates(
  session: AuthorizedSession,
  projectId: string,
  names: readonly string[],
  folders: Readonly<Record<string, string | null>> = {},
): Promise<RevisionCandidateMatch[]> {
  await requireProjectAccess(session, projectId, 'project:view')
  const shelf = projectShelf(projectId)
  const projectCollection = await shelfCollectionName(shelf, session.organizationId)
  if (!projectCollection) return []
  const access = await getProjectFolderAccess(session, projectId, projectCollection)
  return revisionCandidatesOnShelf(shelf, session.organizationId, names, {
    hiddenFolderIds: [...access.hiddenFolderIds],
    reader: await shelfReaderFor(session, { scope: 'project', projectId }),
    collectionFor: (name) => access.collectionFor(Object.hasOwn(folders, name) ? (folders[name] ?? null) : null),
  })
}
