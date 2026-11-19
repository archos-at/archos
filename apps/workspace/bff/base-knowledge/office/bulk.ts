import 'server-only'
import { ApiError, ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import type { BulkEntriesBody, BulkEntriesResult, BulkEntryResult } from '../wire'
import { isStandardsFolder } from './folders'
import { getBaseKnowledgeEntry, recordBaseKnowledgeCheck, removeBaseKnowledge } from './service'

async function runOne(entryId: string, action: () => Promise<unknown>): Promise<BulkEntryResult> {
  try {
    await action()
    return { entryId, ok: true, error: null }
  } catch (error) {
    if (error instanceof ApiError) return { entryId, ok: false, error: error.message }
    throw error
  }
}

export async function moveEntry(session: AuthorizedSession, entryId: string, folderId: string): Promise<void> {
  const entry = await getBaseKnowledgeEntry(session, entryId)
  if (entry.folderId === folderId) return
  const moved = await moveDocumentToFolder({ documentId: entry.documentId, folderId }, session)
  if (!moved.ok) throw new UnprocessableError(moved.error)
}

export async function removeEntry(session: AuthorizedSession, entryId: string, request: Request): Promise<void> {
  const removal = await removeBaseKnowledge(session, entryId, request)
  if (removal.removed) return
  const left = Object.entries(removal.stores).flatMap(([store, state]) => (state === 'removed' || state === 'none' ? [] : [store]))
  throw new UnprocessableError(`Removed and no longer quoted, but ${left.join(', ')} could not be cleared right away.`)
}

export async function bulkBaseKnowledge(
  session: AuthorizedSession,
  body: BulkEntriesBody,
  request: Request,
): Promise<BulkEntriesResult> {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
  const { action } = body
  if (action.type === 'move' && !(await isStandardsFolder(session, action.folderId))) {
    throw new UnprocessableError('folderId is not a base-knowledge folder; take one from base-knowledge-folder-list.')
  }
  const ids = [...new Set(body.entryIds)]
  const results: BulkEntryResult[] = []
  for (const entryId of ids) {
    results.push(
      await runOne(entryId, () => {
        if (action.type === 'check') return recordBaseKnowledgeCheck(session, entryId, { result: action.result, note: action.note })
        if (action.type === 'move') return moveEntry(session, entryId, action.folderId)
        return removeEntry(session, entryId, request)
      }),
    )
  }
  return { results }
}
