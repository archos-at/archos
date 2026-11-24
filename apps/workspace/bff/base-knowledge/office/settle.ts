import 'server-only'
import { ApiError, ConflictError, ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import { ASK_FOR_LICENCE, UNKNOWN_EDITION, type SettledProposal, type SettleOutcome, type SettleProposalsBody, type SettleProposalsResult } from '../wire'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { listOfficeShelfFolders } from '@/lib/office-shelf/folder-service'
import { isUnderStandardsRoot } from '@/lib/office-shelf/standards-folder'
import { moveEntry, removeEntry } from './bulk'
import { keepAsOrdinaryFiles } from './folder-norms-repository'
import { standardsFolderRows, standardsRoot } from './folders'
import { arrivedAsUpload, editionKey, heldEditionsOf, isDuplicateEdition } from './proposal-match'
import {
  confirmBaseKnowledge,
  dropBaseKnowledgeRecords,
  getBaseKnowledgeEntry,
  reviseProposal,
  storedEntryOf,
} from './service'

type Row = SettleProposalsBody['rows'][number]

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function editionOf(row: Row, stored: StoredEntry): string | null {
  if (row.editionLabel === undefined) return editionKey(stored.values.editionLabel) ? stored.values.editionLabel : null
  return editionKey(row.editionLabel ?? null) ? (row.editionLabel ?? '').trim() : null
}

function issuedOnOf(label: string, stored: StoredEntry): string | null {
  if (ISO_DAY.test(label)) return label
  return label === stored.values.editionLabel ? stored.values.issuedOn : null
}

async function folderOfWork(session: AuthorizedSession, held: StoredEntry, topics: ReadonlySet<string>, rootId: string): Promise<string> {
  const { folderId } = await getBaseKnowledgeEntry(session, held.editionId)
  return folderId && topics.has(folderId) ? folderId : rootId
}

interface Place {
  topics: ReadonlySet<string>
  rootId: string
  ordner: ReadonlySet<string>
}

async function keepProposed(
  session: AuthorizedSession,
  row: Row,
  stored: StoredEntry,
  folderId: string | null,
  held: readonly StoredEntry[],
  { rootId }: Place,
): Promise<void> {
  const edited = held.length > 0 ? {} : { kind: row.kind, designation: row.designation }
  const cleared = row.editionLabel === undefined ? {} : { editionLabel: UNKNOWN_EDITION, issuedOn: null }
  await reviseProposal(session, stored.editionId, { ...edited, ...cleared })
  if (held.length > 0 || row.topicId === undefined) return
  const target = row.topicId ?? rootId
  if (target !== folderId) await moveEntry(session, stored.editionId, target)
}

async function keepAsOrdinaryFile(session: AuthorizedSession, stored: StoredEntry, lies: string | null, { topics, ordner }: Place): Promise<void> {
  if (lies && topics.has(lies)) {
    const origin = stored.provenance.filedFrom?.folderId ?? null
    const moved = await moveDocumentToFolder({ documentId: stored.documentId, folderId: origin && ordner.has(origin) ? origin : null }, session)
    if (!moved.ok) throw new UnprocessableError(moved.error)
  }
  await dropBaseKnowledgeRecords(session, stored)
  await keepAsOrdinaryFiles(session.organizationId, [stored.documentId], session.userId)
}

async function settleOne(session: AuthorizedSession, row: Row, request: Request, place: Place): Promise<SettleOutcome> {
  const { topics, rootId } = place
  const { stored, entry } = await storedEntryOf(session, row.entryId)
  if (stored.confirmed) {
    if (row.notNorm) throw new ConflictError('This entry is confirmed; take it off the norms with base-knowledge-unlist.')
    return 'confirmed'
  }
  const lies = entry.folderId ?? null
  if (row.notNorm) {
    await keepAsOrdinaryFile(session, stored, lies, place)
    return 'not_norm'
  }
  if (row.topicId && !topics.has(row.topicId)) {
    throw new UnprocessableError('topicId is not a base-knowledge folder; take one from base-knowledge-folder-list.')
  }
  const label = editionOf(row, stored)
  const held = heldEditionsOf(stored, await readOfficeEntries(session.organizationId))
  if (!label) {
    await keepProposed(session, row, stored, lies, held, place)
    return 'edition_missing'
  }
  if (isDuplicateEdition(label, held)) {
    if (!arrivedAsUpload(stored)) {
      await keepAsOrdinaryFile(session, stored, lies, place)
      return 'duplicate_returned'
    }
    await removeEntry(session, stored.editionId, request)
    return 'duplicate_removed'
  }
  const edition = { editionLabel: label, issuedOn: issuedOnOf(label, stored) }
  const values = held.length > 0 ? edition : { ...edition, kind: row.kind, designation: row.designation }
  await confirmBaseKnowledge(session, stored.editionId, values, { licenceStep: ASK_FOR_LICENCE })
  const folderId = held.length > 0 ? await folderOfWork(session, held[0], topics, rootId) : (row.topicId ?? rootId)
  await moveEntry(session, stored.editionId, folderId)
  return held.length > 0 ? 'edition_added' : 'confirmed'
}

export async function settleProposals(
  session: AuthorizedSession,
  body: SettleProposalsBody,
  request: Request,
): Promise<SettleProposalsResult> {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
  const [root, { folders }, shelf] = await Promise.all([
    standardsRoot(session.organizationId),
    standardsFolderRows(session),
    listOfficeShelfFolders(session),
  ])
  const topics = new Set([root.id, ...folders.map((folder) => folder.id)])
  const ordner = new Set(shelf.filter((folder) => !isUnderStandardsRoot(folder.path)).map((folder) => folder.id))
  const place = { topics, rootId: root.id, ordner }
  const results: SettledProposal[] = []
  const seen = new Set<string>()
  for (const row of body.rows) {
    if (seen.has(row.entryId)) continue
    seen.add(row.entryId)
    try {
      results.push({ entryId: row.entryId, outcome: await settleOne(session, row, request, place), error: null })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      results.push({ entryId: row.entryId, outcome: 'failed', error: error.message })
    }
  }
  return { results }
}
