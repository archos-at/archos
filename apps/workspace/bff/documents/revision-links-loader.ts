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
import { isUuid } from '@/lib/ids'
import { documentNameKey } from './name-match'
import { readRevisionLinkNames, refreshCollectionFiles } from './reconcile-status'
import { findRevisionCounterparts, type RevisionCounterpartRow } from './repository'
import { revisionCounterpartOf, revisionReferenceKey } from './revision-reference'

export interface RevisionLinksSubject extends AuthoredDocumentRow {
  id: string
}

interface VisibleRef extends RevisionRef {
  createdAt: string | null
}

type RefLookup = (reference: string) => VisibleRef | null

async function visibleRefs(
  session: AuthorizedSession,
  collectionName: string,
  references: readonly string[],
  reader: DocumentReader,
): Promise<RefLookup> {
  const rows = await findRevisionCounterparts(session.organizationId, collectionName, references, reader)
  const hidden = await hiddenFoldersByProject(session, rows)
  return (reference) => {
    const row = revisionCounterpartOf(rows, reference)
    if (!row) return null
    if (row.projectId !== null && row.folderId !== null && hidden.get(row.projectId)?.has(row.folderId)) return null
    return { id: row.id, filename: row.filename, createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null }
  }
}

const namesOf = (collectionName: string, reference: string): Promise<RevisionLinkNames | null> => {
  const ref = collectionFileRef({
    id: isUuid(reference) ? reference : null,
    collectionName,
    filename: reference,
    authoredBy: 'user',
    authoredByProducer: null,
    publishedVersionId: null,
  })
  return ref ? readRevisionLinkNames(ref) : Promise.resolve(null)
}

async function walkHistory(
  collectionName: string,
  subject: RevisionLinksSubject,
  names: RevisionLinkNames,
): Promise<Array<{ reference: string; names: RevisionLinkNames | null }>> {
  const seen = new Set<string>([subject.id, documentNameKey(subject.filename)])
  const walked: Array<{ reference: string; names: RevisionLinkNames | null }> = []
  let frontier = names.supersedes
  while (frontier.length > 0 && walked.length < REVISION_MAX_HISTORY) {
    const next: string[] = []
    for (const reference of frontier) {
      const key = revisionReferenceKey(reference)
      if (seen.has(key) || walked.length >= REVISION_MAX_HISTORY) continue
      seen.add(key)
      const own = await namesOf(collectionName, reference)
      walked.push({ reference, names: own })
      next.push(...(own?.supersedes ?? []))
    }
    frontier = next
  }
  return walked
}

function namedAsItself(names: RevisionLinkNames, subject: { id: string; filename: string }): RevisionLinkNames {
  const own = (reference: string | null): string | null => (reference === subject.id ? subject.filename : reference)
  return {
    supersededBy: own(names.supersededBy),
    supersedes: names.supersedes.map((reference) => own(reference) ?? reference),
    suggestion: names.suggestion ? { ...names.suggestion, of: own(names.suggestion.of) ?? names.suggestion.of } : null,
    change: names.change ? { ...names.change, basis: own(names.change.basis) } : null,
  }
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
      if (names) named.push({ subject, names: namedAsItself(names, subject) })
    }),
  )
  if (named.length === 0) return facts

  const wanted = new Map<string, Set<string>>()
  for (const { subject, names } of named) {
    const set = wanted.get(subject.collectionName) ?? new Set<string>()
    for (const reference of referencedNames(names, subject.filename)) set.add(reference)
    wanted.set(subject.collectionName, set)
  }
  const histories = new Map<string, Array<{ reference: string; names: RevisionLinkNames | null }>>()
  await Promise.all(
    named.map(async ({ subject, names }) => {
      if (names.supersedes.length === 0) return
      const walked = await walkHistory(subject.collectionName, subject, names)
      histories.set(subject.id, walked)
      const set = wanted.get(subject.collectionName) ?? new Set<string>()
      for (const step of walked) {
        set.add(step.reference)
        for (const reference of step.names?.supersedes ?? []) set.add(reference)
      }
      wanted.set(subject.collectionName, set)
    }),
  )
  const refsByCollection = new Map<string, RefLookup>()
  await Promise.all(
    [...wanted].map(async ([collectionName, references]) => {
      refsByCollection.set(
        collectionName,
        references.size === 0 ? () => null : await visibleRefs(session, collectionName, [...references], reader),
      )
    }),
  )

  for (const { subject, names } of named) {
    const refs = refsByCollection.get(subject.collectionName) ?? (() => null)
    const lookup = (reference: string): RevisionRef | null => {
      const ref = refs(reference)
      return ref && ref.id !== subject.id ? { id: ref.id, filename: ref.filename } : null
    }
    const resolved = resolveRevisionLinks(names, subject.filename, lookup)
    const history = historyFor(histories.get(subject.id) ?? [], refs, lookup, subject.id)
    if (history.length > 0) facts.set(subject.id, { ...(resolved ?? EMPTY_REVISION_LINKS), history })
    else if (resolved) facts.set(subject.id, resolved)
  }
  return facts
}

function historyFor(
  walked: ReadonlyArray<{ reference: string; names: RevisionLinkNames | null }>,
  refs: RefLookup,
  lookup: (reference: string) => RevisionRef | null,
  ownId: string,
): RevisionHistoryEntry[] {
  const entries: RevisionHistoryEntry[] = []
  for (const step of walked) {
    const ref = refs(step.reference)
    if (!ref || ref.id === ownId) continue
    const own = step.names ? resolveRevisionLinks(namedAsItself(step.names, ref), ref.filename, lookup) : null
    entries.push({ ...ref, changeSummary: own?.changeSummary?.text ?? null })
  }
  return entries
}
