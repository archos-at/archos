import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { lockConversationAudience, recordSourceFolders } from '@/lib/conversations/restricted-use-repository'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { eraseShelfDocument } from '@/lib/documents/document-edits'
import { shelfProjectId, type SharedShelf } from '@/lib/documents/shelf'
import { getDeletedFolderContentPolicy } from '@/lib/organizations/deleted-folder-content'
import { inPool } from '@/lib/utils/in-pool'
import { binEntryFor, binPolicyOf } from './bin-shelf'
import {
  type BinEntryClaim,
  type BinFolderRow,
  claimBinEntryNow,
  closeBinEntryPurged,
  findActiveBinEntry,
  findFolderByIdInOrg,
  handBinEntryToPurger,
  listDocumentsInFolders,
  listEntryFolderIds,
  markFoldersPurged,
  mergeBinEntryPayload,
  releaseBinEntry,
  type FolderBinPayload,
  type FolderPurgeCounts,
} from './folder-bin-repository'
import {
  deleteMemoryDrawnFrom,
  findAnswersDrawingOn,
  listReportsDerivedFrom,
  markAnswersSourceDeleted,
  markReportsSourceDeleted,
  replaceRemovedAnswers,
} from './folder-derived-repository'

const ERASE_CONCURRENCY = 4

export interface FolderPurgeResult {
  status: 'purged' | 'already-purged'
  counts: FolderPurgeCounts
  traceConversationIds: string[]
}

export class FolderNotInBinError extends ConflictError {
  constructor() {
    super('The folder is not in the bin.', { reason: 'not_in_bin' })
  }
}

const EMPTY_COUNTS: FolderPurgeCounts = {
  documents: 0,
  folders: 0,
  memoryNotes: 0,
  answers: 0,
  conversations: 0,
  reports: 0,
  tracesErased: 0,
}

async function recordFolderOnConversations(organizationId: string, conversationIds: readonly string[], folderId: string): Promise<void> {
  const db = getDb()
  for (const conversationId of conversationIds) {
    await withTenant({ organizationId }, () =>
      db.transaction(async (tx) => {
        await lockConversationAudience(tx, organizationId, conversationId)
        await recordSourceFolders(tx, organizationId, conversationId, [folderId])
      })
    )
  }
}

interface DerivedFromFolder {
  conversationIds: string[]
  messageIds: string[]
  reportIds: string[]
}

async function markDerivedContent(root: BinFolderRow, docs: Awaited<ReturnType<typeof listDocumentsInFolders>>, at: Date): Promise<DerivedFromFolder> {
  const { organizationId } = root
  const projectId = shelfProjectId(root.shelf)
  if (projectId === null) return { conversationIds: [], messageIds: [], reportIds: [] }
  const answers = await findAnswersDrawingOn(
    organizationId,
    projectId,
    docs.map((doc) => ({ id: doc.id, collectionName: doc.collectionName, filename: doc.filename })),
    root.id
  )
  const conversationIds = [...new Set(answers.map((answer) => answer.conversationId))]
  const messageIds = answers.map((answer) => answer.messageId)
  await recordFolderOnConversations(organizationId, conversationIds, root.id)
  await markAnswersSourceDeleted(organizationId, messageIds, root.id, at)
  const reports = await listReportsDerivedFrom(organizationId, conversationIds, messageIds)
  await markReportsSourceDeleted(organizationId, reports.map((report) => report.id), root.id, at)
  return { conversationIds, messageIds, reportIds: reports.map((report) => report.id) }
}

export async function purgeBinnedFolder(organizationId: string, folderId: string): Promise<FolderPurgeResult> {
  const db = getDb()
  const root = await withTenant({ organizationId }, () => findFolderByIdInOrg(db, organizationId, folderId))
  if (!root || !root.deletedAt) throw new FolderNotInBinError()
  await assertNoActiveHold(organizationId, 'folder', root.id)

  const entry = await withTenant({ organizationId }, () => findActiveBinEntry(db, organizationId, root.id))
  const payload = (entry?.payload ?? null) as Partial<FolderBinPayload> | null
  if (root.purgedAt) {
    return {
      status: 'already-purged',
      counts: { ...EMPTY_COUNTS, ...(payload?.purged ?? {}) },
      traceConversationIds: payload?.derivedRemoval?.conversationIds ?? [],
    }
  }
  const removeDerived = (await getDeletedFolderContentPolicy(organizationId)) === 'remove'
  const previous = payload?.derivedRemoval

  const folderIds = await withTenant({ organizationId }, () => listEntryFolderIds(db, root))
  const docs = await listDocumentsInFolders(organizationId, root.shelf, folderIds)
  const at = new Date()

  const { conversationIds, messageIds, reportIds } = await markDerivedContent(root, docs, at)

  let memoryIds: string[] = []
  let replaced = 0
  const projectId = shelfProjectId(root.shelf)
  if (removeDerived && projectId !== null) {
    memoryIds = await deleteMemoryDrawnFrom(organizationId, projectId, folderIds, conversationIds)
    replaced = await replaceRemovedAnswers(organizationId, messageIds, root.id, at)
    await mergeBinEntryPayload(organizationId, root.id, {
      derivedRemoval: {
        removedAt: previous?.removedAt ?? at.toISOString(),
        conversationIds: [...new Set([...(previous?.conversationIds ?? []), ...conversationIds])],
        messageIds: [...new Set([...(previous?.messageIds ?? []), ...messageIds])],
        memoryIds: [...new Set([...(previous?.memoryIds ?? []), ...memoryIds])],
        reportIds: [...new Set([...(previous?.reportIds ?? []), ...reportIds])],
      },
    })
  }

  await assertNoActiveHold(organizationId, 'folder', root.id)
  await inPool(docs, ERASE_CONCURRENCY, (doc) => eraseShelfDocument(doc, organizationId))
  const folders = await withTenant({ organizationId }, () => markFoldersPurged(db, root, at))

  const counts: FolderPurgeCounts = {
    documents: docs.length,
    folders: Math.max(folders, folderIds.length),
    memoryNotes: memoryIds.length,
    answers: removeDerived ? replaced : messageIds.length,
    conversations: conversationIds.length,
    reports: reportIds.length,
    tracesErased: 0,
  }
  const traceConversationIds = removeDerived
    ? [...new Set([...(previous?.conversationIds ?? []), ...conversationIds])]
    : []
  return { status: 'purged', counts, traceConversationIds }
}

async function purgeClaimedNow(organizationId: string, folderId: string, claim: BinEntryClaim): Promise<FolderPurgeResult> {
  try {
    const result = await purgeBinnedFolder(organizationId, folderId)
    if (result.traceConversationIds.length > 0) {
      await handBinEntryToPurger(organizationId, folderId, claim, { purged: result.counts })
    } else {
      await closeBinEntryPurged(organizationId, folderId, claim, { purged: result.counts })
    }
    return result
  } catch (error) {
    await releaseBinEntry(organizationId, folderId, claim, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    throw error
  }
}

export async function purgeFolderFromBinNow(
  session: AuthorizedSession,
  input: { shelf: SharedShelf; folderId: string },
  request?: Request
): Promise<FolderPurgeResult> {
  await binPolicyOf(input.shelf).assertMayPurge(session)
  const { root, policy } = await binEntryFor(session, input.shelf, input.folderId)
  await assertNoActiveHold(session.organizationId, 'folder', root.id)
  const claim = await claimBinEntryNow(session.organizationId, root.id)
  if (!claim) throw new ConflictError('This folder is already being deleted.')
  const result = await purgeClaimedNow(session.organizationId, root.id, claim)
  const audit = policy.audit(session.organizationId)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: audit.purged,
    targetType: audit.targetType,
    targetId: audit.targetId,
    metadata: { folderId: root.id, documents: result.counts.documents, folders: result.counts.folders },
    request,
  })
  return result
}
