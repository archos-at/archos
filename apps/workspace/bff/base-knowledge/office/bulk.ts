/**
 * One change to many entries at once (ADR-0163 amendment): record a check, move
 * them into a base-knowledge folder, or remove them. Bounded by
 * `MAX_BULK_ENTRIES` so the call stays one short request; each entry runs
 * through the single-entry service, with its own authorization and its own
 * refusal, so one refused entry does not undo the others and the answer says
 * which ran.
 */

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

async function moveEntry(session: AuthorizedSession, entryId: string, folderId: string): Promise<void> {
  const entry = await getBaseKnowledgeEntry(session, entryId)
  if (entry.folderId === folderId) return
  const moved = await moveDocumentToFolder({ documentId: entry.documentId, folderId }, session)
  if (!moved.ok) throw new UnprocessableError(moved.error)
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
  // One after another: a removal runs the office shelf's delete with its backend calls, and a burst of those helps nobody.
  for (const entryId of ids) {
    results.push(
      await runOne(entryId, () => {
        if (action.type === 'check') return recordBaseKnowledgeCheck(session, entryId, { result: action.result, note: action.note })
        if (action.type === 'move') return moveEntry(session, entryId, action.folderId)
        return removeBaseKnowledge(session, entryId, request)
      }),
    )
  }
  return { results }
}
