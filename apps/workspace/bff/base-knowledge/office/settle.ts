import 'server-only'
import { ApiError, ConflictError, ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import type { SettledProposal, SettleOutcome, SettleProposalsBody, SettleProposalsResult } from '../wire'
import { moveEntry, removeEntry } from './bulk'
import { standardsFolderRows, standardsRoot } from './folders'
import { editionKey, heldEditionsOf, isDuplicateEdition } from './proposal-match'
import { confirmBaseKnowledge, dropBaseKnowledgeRecords, getBaseKnowledgeEntry, storedEntryOf } from './service'

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

async function settleOne(
  session: AuthorizedSession,
  row: Row,
  request: Request,
  topics: ReadonlySet<string>,
  rootId: string,
): Promise<SettleOutcome> {
  const { stored } = await storedEntryOf(session, row.entryId)
  if (stored.confirmed) {
    if (row.notNorm) throw new ConflictError('This entry is confirmed; take it off the norms with base-knowledge-unlist.')
    return 'confirmed'
  }
  if (row.notNorm) {
    await dropBaseKnowledgeRecords(session, stored)
    return 'not_norm'
  }
  if (row.topicId && !topics.has(row.topicId)) {
    throw new UnprocessableError('topicId is not a base-knowledge folder; take one from base-knowledge-folder-list.')
  }
  const label = editionOf(row, stored)
  if (!label) return 'edition_missing'
  const held = heldEditionsOf(stored, await readOfficeEntries(session.organizationId))
  if (isDuplicateEdition(label, held)) {
    await removeEntry(session, stored.editionId, request)
    return 'duplicate_removed'
  }
  const edition = { editionLabel: label, issuedOn: issuedOnOf(label, stored) }
  const values = held.length > 0 ? edition : { ...edition, kind: row.kind, designation: row.designation }
  await confirmBaseKnowledge(session, stored.editionId, values)
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
  const [root, { folders }] = await Promise.all([standardsRoot(session.organizationId), standardsFolderRows(session)])
  const topics = new Set([root.id, ...folders.map((folder) => folder.id)])
  const results: SettledProposal[] = []
  const seen = new Set<string>()
  for (const row of body.rows) {
    if (seen.has(row.entryId)) continue
    seen.add(row.entryId)
    try {
      results.push({ entryId: row.entryId, outcome: await settleOne(session, row, request, topics, root.id), error: null })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      results.push({ entryId: row.entryId, outcome: 'failed', error: error.message })
    }
  }
  return { results }
}
