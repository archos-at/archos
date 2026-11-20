import 'server-only'
import { ForbiddenError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import type { FolderRow } from '@/lib/documents/shelf-folders'
import { listOfficeShelfFolders } from '@/lib/office-shelf/folder-service'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import type { OfficeWorkKind } from '@/lib/base-knowledge/wire/vocab'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import type { NormProposal, NormRecognition, PlainUpload, RecognizeBody } from '../wire'
import { keptAsOrdinaryFiles } from './folder-norms-repository'
import { listBaseKnowledgeFolders, standardsFolderRows, standardsRoot } from './folders'
import { takeAsNorm } from './norm-intake'
import { recognizeNorm } from './reading'
import { visibleOfficeDocuments, type EntryDocument } from './repository'
import { arrivedAsUpload, editionKey, heldEditionsOf, isDuplicateEdition } from './proposal-match'

export function proposeTopic(
  kind: OfficeWorkKind,
  entries: readonly StoredEntry[],
  folderOf: ReadonlyMap<string, string | null>,
  topics: ReadonlySet<string>,
): string | null {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const folderId = folderOf.get(entry.documentId)
    if (!entry.confirmed || entry.values.kind !== kind || !folderId || !topics.has(folderId)) continue
    counts.set(folderId, (counts.get(folderId) ?? 0) + 1)
  }
  return [...counts].sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
}

function proposalOf(
  entry: StoredEntry,
  entries: readonly StoredEntry[],
  documents: ReadonlyMap<string, EntryDocument>,
  topics: ReadonlySet<string>,
): NormProposal {
  const held = heldEditionsOf(entry, entries)
  const latest = held[0]
  const folderOf = new Map([...documents].map(([id, document]) => [id, document.folderId]))
  const own = documents.get(entry.documentId)?.folderId ?? null
  const topicId = latest
    ? (folderOf.get(latest.documentId) ?? null)
    : own && topics.has(own)
      ? own
      : proposeTopic(entry.values.kind, entries, folderOf, topics)
  return {
    entryId: entry.editionId,
    documentId: entry.documentId,
    fileName: documents.get(entry.documentId)?.fileName ?? '',
    kind: entry.values.kind,
    designation: entry.values.designation,
    editionLabel: editionKey(entry.values.editionLabel) ? entry.values.editionLabel : null,
    topicId: topicId && topics.has(topicId) ? topicId : null,
    editionOf: latest
      ? { entryId: latest.editionId, designation: latest.values.designation, editionLabel: latest.values.editionLabel }
      : null,
    duplicate: isDuplicateEdition(entry.values.editionLabel, held),
    heldEditions: held.map((other) => other.values.editionLabel),
    upload: arrivedAsUpload(entry),
    coverOverrode: entry.provenance.cover?.overrode ?? [],
  }
}

function plainOf(document: EntryDocument, platformHeld: boolean, folders: readonly FolderRow[]): PlainUpload {
  const folder = document.folderId ? folders.find((row) => row.id === document.folderId) : undefined
  return {
    documentId: document.id,
    fileName: document.fileName,
    folderId: document.folderId,
    folderPath: folder?.path ?? null,
    platformHeld,
  }
}

export async function recognizeUploads(session: AuthorizedSession, body: RecognizeBody): Promise<NormRecognition> {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
  const organizationId = session.organizationId
  const reader = await shelfReaderFor(session, { scope: 'office_shelf', projectId: null })
  const ids = [...new Set(body.documentIds)]
  const [uploads, before, root, standards, kept] = await Promise.all([
    visibleOfficeDocuments(organizationId, ids, reader),
    readOfficeEntries(organizationId),
    standardsRoot(organizationId),
    standardsFolderRows(session),
    body.asNorm ? Promise.resolve(new Set<string>()) : keptAsOrdinaryFiles(organizationId, ids, reader),
  ])
  const recorded = new Set(before.map((entry) => entry.documentId))
  const place = { rootId: root.id, entries: before, standards: new Set([root.id, ...standards.folders.map((folder) => folder.id)]) }
  const plain: { document: EntryDocument; platformHeld: boolean }[] = []
  for (const id of ids) {
    const document = uploads.get(id)
    if (!document || recorded.has(id)) continue
    const reading = recognizeNorm({ fileName: document.fileName })
    if ((!reading.norm || kept.has(id)) && !body.asNorm) {
      plain.push({ document, platformHeld: !reading.norm && reading.platformHeld })
      continue
    }
    const designation = reading.norm ? reading.designation : null
    await takeAsNorm(session, { documentId: id, fileName: document.fileName, folderId: document.folderId, designation }, place)
  }
  const entries = await readOfficeEntries(organizationId)
  const [documents, topics, shelfFolders] = await Promise.all([
    visibleOfficeDocuments(organizationId, entries.map((entry) => entry.documentId), reader),
    listBaseKnowledgeFolders(session),
    plain.length > 0 ? listOfficeShelfFolders(session) : Promise.resolve([]),
  ])
  const topicIds = new Set(standards.folders.map((folder) => folder.id))
  const proposals = entries
    .filter((entry) => !entry.confirmed && uploads.has(entry.documentId) && documents.has(entry.documentId))
    .sort((a, b) => ids.indexOf(a.documentId) - ids.indexOf(b.documentId))
    .map((entry) => proposalOf(entry, entries, documents, topicIds))
  return {
    proposals,
    plain: plain.map(({ document, platformHeld }) => plainOf(document, platformHeld, shelfFolders)),
    topics,
  }
}
