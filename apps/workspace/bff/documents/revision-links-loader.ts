import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import { collectionFileRef, type AuthoredDocumentRow } from './collection-file-ref'
import type { DocumentReader } from './document-reader'
import {
  EMPTY_REVISION_LINKS,
  REVISION_MAX_HISTORY,
  referencedNames,
  resolveRevisionLinks,
  type RevisionLinks,
  type RevisionHistoryEntry,
  type RevisionLinkNames,
  type RevisionRef,
} from './revision-links'
import { documentNameKey } from './name-match'
import { readRevisionLinkNames, refreshCollectionFiles } from './reconcile-status'
import { findRevisionCounterparts, type RevisionCounterpartRow } from './repository'

export interface RevisionLinksSubject extends AuthoredDocumentRow {
  id: string
}

async function visibleRefs(
  session: AuthorizedSession,
  collectionName: string,
  filenames: readonly string[],
  reader: DocumentReader,
): Promise<Map<string, VisibleRef>> {
  const rows = await findRevisionCounterparts(session.organizationId, collectionName, filenames, reader)
  const hidden = await hiddenFoldersByProject(session, rows)
  const refs = new Map<string, VisibleRef>()
  for (const row of rows) {
    const closed = row.projectId !== null && row.folderId !== null && hidden.get(row.projectId)?.has(row.folderId)
    if (closed) continue
    refs.set(documentNameKey(row.filename), {
      id: row.id,
      filename: row.filename,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    })
  }
  return refs
}

interface VisibleRef extends RevisionRef {
  createdAt: string | null
}

const namesOf = (collectionName: string, filename: string): Promise<RevisionLinkNames | null> => {
  const ref = collectionFileRef({
    id: null,
    collectionName,
    filename,
    authoredBy: 'user',
    authoredByProducer: null,
    publishedVersionId: null,
  })
  return ref ? readRevisionLinkNames(ref) : Promise.resolve(null)
}

async function walkHistory(
  collectionName: string,
  ownName: string,
  names: RevisionLinkNames,
): Promise<Array<{ filename: string; names: RevisionLinkNames | null }>> {
  const seen = new Set<string>([documentNameKey(ownName)])
  const walked: Array<{ filename: string; names: RevisionLinkNames | null }> = []
  let frontier = names.supersedes
  while (frontier.length > 0 && walked.length < REVISION_MAX_HISTORY) {
    const next: string[] = []
    for (const filename of frontier) {
      const key = documentNameKey(filename)
      if (seen.has(key) || walked.length >= REVISION_MAX_HISTORY) continue
      seen.add(key)
      const own = await namesOf(collectionName, filename)
      walked.push({ filename, names: own })
      next.push(...(own?.supersedes ?? []))
    }
    frontier = next
  }
  return walked
}

async function hiddenFoldersByProject(
  session: AuthorizedSession,
  rows: readonly RevisionCounterpartRow[],
): Promise<Map<string, ReadonlySet<string>>> {
  const projectIds = [
    ...new Set(rows.filter((row) => row.folderId !== null).map((row) => row.projectId)),
  ].filter((id): id is string => id !== null)
  const hidden = await Promise.all(projectIds.map((projectId) => getHiddenFolderIds(session, projectId)))
  return new Map(projectIds.map((projectId, index) => [projectId, new Set(hidden[index])]))
}

export async function loadRevisionLinks(
  session: AuthorizedSession,
  subjects: readonly RevisionLinksSubject[],
  reader: DocumentReader,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<Map<string, RevisionLinks>> {
  const facts = new Map<string, RevisionLinks>()
  if (fresh) {
    const collections = new Set<string>()
    for (const subject of subjects) if (collectionFileRef(subject)) collections.add(subject.collectionName)
    await Promise.all([...collections].map((collection) => refreshCollectionFiles(collection)))
  }

  const named: Array<{ subject: RevisionLinksSubject; names: RevisionLinkNames }> = []
  await Promise.all(
    subjects.map(async (subject) => {
      const ref = collectionFileRef(subject)
      const names = ref ? await readRevisionLinkNames(ref) : null
      if (names) named.push({ subject, names })
    }),
  )
  if (named.length === 0) return facts

  const wanted = new Map<string, Set<string>>()
  for (const { subject, names } of named) {
    const set = wanted.get(subject.collectionName) ?? new Set<string>()
    for (const filename of referencedNames(names, subject.filename)) set.add(filename)
    wanted.set(subject.collectionName, set)
  }
  const histories = new Map<string, Array<{ filename: string; names: RevisionLinkNames | null }>>()
  await Promise.all(
    named.map(async ({ subject, names }) => {
      if (names.supersedes.length === 0) return
      const walked = await walkHistory(subject.collectionName, subject.filename, names)
      histories.set(subject.id, walked)
      const set = wanted.get(subject.collectionName) ?? new Set<string>()
      for (const step of walked) {
        set.add(step.filename)
        for (const filename of step.names?.supersedes ?? []) set.add(filename)
      }
      wanted.set(subject.collectionName, set)
    }),
  )
  const refsByCollection = new Map<string, Map<string, VisibleRef>>()
  await Promise.all(
    [...wanted].map(async ([collectionName, filenames]) => {
      refsByCollection.set(
        collectionName,
        filenames.size === 0 ? new Map() : await visibleRefs(session, collectionName, [...filenames], reader),
      )
    }),
  )

  for (const { subject, names } of named) {
    const refs = refsByCollection.get(subject.collectionName)
    const lookup = (filename: string): RevisionRef | null => {
      const ref = refs?.get(documentNameKey(filename))
      return ref ? { id: ref.id, filename: ref.filename } : null
    }
    const resolved = resolveRevisionLinks(names, subject.filename, lookup)
    const history = historyFor(histories.get(subject.id) ?? [], refs, lookup)
    if (history.length > 0) facts.set(subject.id, { ...(resolved ?? EMPTY_REVISION_LINKS), history })
    else if (resolved) facts.set(subject.id, resolved)
  }
  return facts
}

function historyFor(
  walked: ReadonlyArray<{ filename: string; names: RevisionLinkNames | null }>,
  refs: Map<string, VisibleRef> | undefined,
  lookup: (filename: string) => RevisionRef | null,
): RevisionHistoryEntry[] {
  const entries: RevisionHistoryEntry[] = []
  for (const step of walked) {
    const ref = refs?.get(documentNameKey(step.filename))
    if (!ref) continue
    const own = resolveRevisionLinks(step.names, step.filename, lookup)
    entries.push({ ...ref, changeSummary: own?.changeSummary?.text ?? null })
  }
  return entries
}
