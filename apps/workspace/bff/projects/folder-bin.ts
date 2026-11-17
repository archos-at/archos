import 'server-only'
import { randomUUID } from 'node:crypto'
import { ConflictError, ForbiddenError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import {
  atLeast,
  clearanceOf,
  computeFolderAccess,
  effectiveFolderLevel,
  folderReadOnlyError,
  folderTree,
  loadCustomFolderTree,
  projectMayWriteDocuments,
  type FolderLevel,
} from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getBackendUrl } from '@/lib/backend-proxy'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { lockConversationAudience, recordSourceFolders } from '@/lib/conversations/restricted-use-repository'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import { withTenant } from '@/lib/db/tenant-context'
import type { Document } from '@/lib/db/schema/documents'
import { computePurgeAfter, folderGraceDays } from '@/lib/deletion/policy'
import { collectionFileRef, purgeIngestedChunks } from '@/lib/documents/collection-file-ref'
import { eraseProjectDocument } from '@/lib/documents/document-edits'
import { projectShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { deleteQueuedJob } from '@/lib/jobs-queue/repository'
import {
  BFF_JOB_PRIORITY,
  emptyCounts,
  requesterOf,
  type JobRequester,
  type PurgeBinnedChunksPayload,
  type RestoreFolderBinPayload,
} from '@/lib/jobs-queue/types'
import { getDeletedFolderContentPolicy } from '@/lib/organizations/deleted-folder-content'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import {
  type BinEntryClaim,
  closeBinEntryPurged,
  closeBinEntryRestored,
  claimBinEntryNow,
  findActiveBinEntry,
  handBinEntryToPurger,
  findFolderByIdInOrg,
  findFolderInOrg,
  listEntryFolderIds,
  findLivingFolder,
  insertFolderBinEntry,
  listBinEntries,
  listDocumentIdsInFolders,
  listDocumentsInFolders,
  listLivingSubtree,
  markDocumentsRestoring,
  markFoldersBinned,
  markFoldersPurged,
  mergeBinEntryPayload,
  rehomeFolder,
  releaseBinEntry,
  takeBinLock,
  unbinFolders,
  type BinFolderRow,
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
import { buildFolderPath } from './folders'
import { findProjectInOrg } from './repository'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { inPool } from '@/lib/utils/in-pool'
import { FOLDER_NAME_TAKEN_REASON } from './folder-bin-codes'
import { BIN_PAGE_SIZE, type BinListQuery } from './folder-bin-wire'
import { decodeDocumentListCursor, encodeDocumentListCursor } from '@/lib/documents/list-cursor'

export const FOLDER_CONTENTS_PROTECTED_REASON = 'folder-contents-protected'

export { FOLDER_NAME_TAKEN_REASON }

const CHUNK_PURGE_TIMEOUT_MS = 15_000
export const BACKEND_CONCURRENCY = 8
const ERASE_CONCURRENCY = 4

export const BIN_PURGE_TAKEOVER_MS = 2 * 60_000

export function purgeChunksOf(doc: Document): Promise<boolean> {
  const ref = collectionFileRef(doc)
  return ref ? purgeIngestedChunks(getBackendUrl(), ref, CHUNK_PURGE_TIMEOUT_MS) : Promise.resolve(true)
}

async function withdrawPurgeJob(organizationId: string, jobId: string): Promise<void> {
  await withTenant({ organizationId }, () => deleteQueuedJob(jobId)).catch((error) => {
    console.warn('[folder-bin] could not withdraw the chunk purge job', jobId, error)
  })
}

function contentsProtectedError(): ForbiddenError {
  return new ForbiddenError('This folder holds content you may not delete.', { reason: FOLDER_CONTENTS_PROTECTED_REASON })
}

async function assertMayBinSubtree(
  session: AuthorizedSession,
  projectId: string,
  rootId: string,
  subtree: readonly string[]
): Promise<void> {
  const folders = await loadCustomFolderTree(session.organizationId, projectId)
  if (!folders) return
  const access = computeFolderAccess(folders, await clearanceOf(session, projectId), '')
  if (!access.isVisible(rootId)) throw new NotFoundError('Folder not found')
  if (access.levelOf(rootId) !== 'write') throw folderReadOnlyError()
  for (const folderId of subtree) {
    if (folderId === rootId) continue
    if (!access.isVisible(folderId) || access.levelOf(folderId) !== 'write') throw contentsProtectedError()
  }
}

async function projectFor(organizationId: string, projectId: string) {
  const project = await findProjectInOrg(projectId, organizationId)
  if (!project) throw new NotFoundError('Project not found')
  return project
}

export interface BinFolderResult {
  documentsBinned: number
  foldersBinned: number
  purgeAfter: Date
}

interface BinOptions {
  purgeAfter?: Date
  onlyDocuments?: readonly string[]
  documentId?: string
}

export const FOLDER_CONTENTS_CHANGED_REASON = 'folder-contents-changed'

export async function moveFolderToBin(
  session: AuthorizedSession,
  input: { projectId: string; folderId: string },
  request?: Request,
  options: BinOptions = {}
): Promise<BinFolderResult> {
  const { organizationId } = session
  await requireProjectAccess(session, input.projectId, ['project:documents:write', 'project:edit'])
  const project = await projectFor(organizationId, input.projectId)
  const db = getDb()
  const root = await withTenant({ organizationId }, () => findFolderInOrg(db, organizationId, project.id, input.folderId))
  if (!root || root.deletedAt) throw new NotFoundError('Folder not found')

  const checked = await withTenant({ organizationId }, () => listLivingSubtree(db, project.id, root.id))
  await assertMayBinSubtree(session, project.id, root.id, checked)

  const purgeAfter = options.purgeAfter ?? computePurgeAfter(new Date(), folderGraceDays())
  const at = new Date()
  const purgeJobId = randomUUID()
  const requester = requesterOf(session)
  const folderIds = await withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      await takeBinLock(tx, project.id)
      const subtree = await listLivingSubtree(tx, project.id, root.id)
      if (subtree.length === 0) throw new NotFoundError('Folder not found')
      const known = new Set(checked)
      if (subtree.some((folderId) => !known.has(folderId))) {
        throw new ConflictError('The folder changed while it was being deleted. Please try again.')
      }
      if (options.onlyDocuments) {
        const held = await listDocumentIdsInFolders(tx, project.id, subtree)
        const expected = new Set(options.onlyDocuments)
        if (held.length !== expected.size || held.some((id) => !expected.has(id))) {
          throw new ConflictError('The folder changed while it was being deleted. Please try again.', {
            reason: FOLDER_CONTENTS_CHANGED_REASON,
          })
        }
      }
      await markFoldersBinned(tx, project.id, subtree, root.id, session.userId, at)
      const payload: FolderBinPayload = {
        projectId: project.id,
        folderIds: subtree,
        documents: 0,
        ...(options.documentId ? { documentId: options.documentId } : {}),
      }
      const entryId = await insertFolderBinEntry(tx, {
        organizationId,
        folderId: root.id,
        displayName: root.path,
        requestedBy: session.userId,
        purgeAfter,
        payload,
      })
      const takeover: PurgeBinnedChunksPayload = {
        projectId: project.id,
        folderId: root.id,
        entryId,
        requester,
        cursor: null,
        documents: 0,
      }
      await enqueueJob(
        {
          kind: 'purge_binned_chunks',
          organizationId,
          payload: { ...takeover },
          priority: BFF_JOB_PRIORITY.interactive,
          jobId: purgeJobId,
          notBefore: new Date(at.getTime() + BIN_PURGE_TAKEOVER_MS),
        },
        tx
      )
      return subtree
    })
  )
  publishShelfChanged(organizationId, projectShelf(project.id), { folders: true })

  const docs = await listDocumentsInFolders(organizationId, project.id, folderIds)
  const purged = await inPool(docs, BACKEND_CONCURRENCY, purgeChunksOf)
  if (purged.some((ok) => !ok)) {
    try {
      await returnFromBin(organizationId, project, root.id, requester)
      await withdrawPurgeJob(organizationId, purgeJobId)
    } catch (error) {
      console.error('[folder-bin] undoing a delete whose chunk purge failed also failed:', root.id, error)
    }
    throw new UpstreamError(
      'The folder could not be moved to the bin: the search index did not confirm. Nothing was deleted; please try again.'
    )
  }
  await mergeBinEntryPayload(organizationId, root.id, { documents: docs.length, chunksPurgedAt: new Date().toISOString() })
  await withdrawPurgeJob(organizationId, purgeJobId)

  await recordAuditEvent({
    organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.folder.binned',
    targetType: 'project',
    targetId: project.id,
    metadata: { folderId: root.id, documents: docs.length, folders: folderIds.length, purgeAfter: purgeAfter.toISOString() },
    request,
  })
  return { documentsBinned: docs.length, foldersBinned: folderIds.length, purgeAfter }
}

type ProjectRow = NonNullable<Awaited<ReturnType<typeof findProjectInOrg>>>

export type RestoredTo = 'original' | 'root'

async function unbinEntry(
  organizationId: string,
  project: ProjectRow,
  root: BinFolderRow,
  requester: JobRequester
): Promise<{ restoredTo: RestoredTo; folders: number; documents: number }> {
  const db = getDb()
  const at = new Date()
  const jobId = randomUUID()
  try {
    const restored = await withTenant({ organizationId }, () =>
      db.transaction(async (tx) => {
        await takeBinLock(tx, project.id)
        if (!(await closeBinEntryRestored(tx, organizationId, root.id))) {
          throw new ConflictError('This folder can no longer be restored: its final deletion has started.')
        }
        const parent = root.parentId ? await findLivingFolder(tx, project.id, root.parentId) : null
        const restoredTo: RestoredTo = root.parentId && !parent ? 'root' : 'original'
        const folderIds = await unbinFolders(tx, project.id, root.id, at)
        const path = buildFolderPath(parent?.path ?? '', root.name)
        await rehomeFolder(tx, project.id, root.id, parent?.id ?? null, root.path, path, at)
        const documents = await markDocumentsRestoring(tx, organizationId, project.id, folderIds, jobId, at)
        if (documents > 0) {
          const payload: RestoreFolderBinPayload = {
            projectId: project.id,
            folderId: root.id,
            jobId,
            requester,
            cursor: null,
            counts: emptyCounts(),
          }
          await enqueueJob(
            { kind: 'restore_folder_bin', organizationId, payload: { ...payload }, priority: BFF_JOB_PRIORITY.bulk, jobId },
            tx
          )
        }
        return { restoredTo, folders: folderIds.length, documents }
      })
    )
    publishShelfChanged(organizationId, projectShelf(project.id), { folders: true })
    return restored
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    throw new ConflictError('A folder with this name already exists there. Rename it, then restore again.', {
      reason: FOLDER_NAME_TAKEN_REASON,
    })
  }
}

export async function returnFromBin(
  organizationId: string,
  project: ProjectRow,
  rootId: string,
  requester: JobRequester
): Promise<void> {
  const db = getDb()
  const root = await withTenant({ organizationId }, () => findFolderInOrg(db, organizationId, project.id, rootId))
  if (!root) return
  await unbinEntry(organizationId, project, root, requester)
}

async function levelOnFolder(session: AuthorizedSession, projectId: string, folderId: string): Promise<FolderLevel> {
  const tree = folderTree(await listProjectFolderTree(session.organizationId, projectId))
  return effectiveFolderLevel(tree, await clearanceOf(session, projectId), folderId)
}

async function binEntryFor(session: AuthorizedSession, projectId: string, folderId: string): Promise<{ project: ProjectRow; root: BinFolderRow; level: FolderLevel }> {
  const project = await projectFor(session.organizationId, projectId)
  const db = getDb()
  const root = await withTenant({ organizationId: session.organizationId }, () =>
    findFolderInOrg(db, session.organizationId, project.id, folderId)
  )
  if (!root || !root.deletedAt || root.purgedAt || root.binRootId !== root.id) throw new NotFoundError('Folder not found')
  const level = await levelOnFolder(session, project.id, root.id)
  if (!atLeast(level, 'read')) throw new NotFoundError('Folder not found')
  return { project, root, level }
}

export interface RestoreFolderResult {
  restoredTo: RestoredTo
  folders: number
  documents: number
}

export async function restoreFolderFromBin(
  session: AuthorizedSession,
  input: { projectId: string; folderId: string },
  request?: Request
): Promise<RestoreFolderResult> {
  const { closed } = await requireProjectAccess(session, input.projectId, 'project:view')
  const { project, root, level } = await binEntryFor(session, input.projectId, input.folderId)
  const projectWrite = await mayRestoreInProject(session, project.id, closed)
  if (level !== 'write' || !projectWrite) throw folderReadOnlyError()

  const { restoredTo, folders, documents } = await unbinEntry(session.organizationId, project, root, requesterOf(session))

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.folder.restored',
    targetType: 'project',
    targetId: project.id,
    metadata: { folderId: root.id, documents, folders, restoredTo },
    request,
  })
  return { restoredTo, folders, documents }
}

async function mayRestoreInProject(session: AuthorizedSession, projectId: string, closed: boolean): Promise<boolean> {
  if (!closed) return projectMayWriteDocuments(session, projectId)
  try {
    await requireProjectAccess(session, projectId, 'project:manage', { evenWhenClosed: true })
    return true
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return false
    throw error
  }
}

export interface FolderBinEntry {
  folderId: string
  name: string
  path: string
  deletedAt: Date
  deletedBy: { userId: string | null; name: string | null }
  purgeAfter: Date
  status: string
  documents: number
  folders: number
  canRestore: boolean
  restoreBlocked: 'folder_read_only' | 'project_closed' | 'no_write' | null // why not, for this reader (`folder-bin-wire.ts`)
  document: { id: string; name: string } | null
}

export interface FolderBinListing {
  entries: FolderBinEntry[]
  canPurge: boolean
  nextCursor: string | null
}

async function mayManageProject(session: AuthorizedSession, projectId: string): Promise<boolean> {
  try {
    await requireProjectAccess(session, projectId, 'project:manage')
    return true
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return false
    throw error
  }
}

export async function listFolderBin(
  session: AuthorizedSession,
  projectId: string,
  query: BinListQuery = {}
): Promise<FolderBinListing> {
  const { closed } = await requireProjectAccess(session, projectId, 'project:view')
  const project = await projectFor(session.organizationId, projectId)
  const cursor = query.cursor ? decodeDocumentListCursor(query.cursor) : null
  const reader = await shelfReaderFor(session, { scope: 'project', projectId: project.id })
  const [page, folders, projectWrite, canPurge, directory] = await Promise.all([
    listBinEntries(session.organizationId, project.id, reader, {
      limit: query.limit ?? BIN_PAGE_SIZE,
      ...(cursor ? { cursor: { deletedAt: cursor.createdAt, folderId: cursor.id } } : {}),
    }),
    listProjectFolderTree(session.organizationId, project.id),
    mayRestoreInProject(session, project.id, closed),
    mayManageProject(session, project.id),
    loadOrganizationDirectory(session.organizationId),
  ])
  const tree = folderTree(folders)
  const clearance = await clearanceOf(session, project.id)
  const entries = page.rows.flatMap((row): FolderBinEntry[] => {
    const level = effectiveFolderLevel(tree, clearance, row.folderId)
    if (!atLeast(level, 'read')) return []
    const person = row.deletedBy ? directory.get(row.deletedBy) : undefined
    return [
      {
        ...row,
        deletedBy: { userId: row.deletedBy, name: person?.name ?? person?.email ?? null },
        canRestore: row.status === 'pending' && level === 'write' && projectWrite,
        restoreBlocked: row.status !== 'pending' ? null : level !== 'write' ? 'folder_read_only' : projectWrite ? null : closed ? 'project_closed' : 'no_write',
      },
    ]
  })
  const nextCursor = page.nextCursor
    ? encodeDocumentListCursor({ createdAt: page.nextCursor.deletedAt, id: page.nextCursor.folderId })
    : null
  return { entries, canPurge, nextCursor }
}

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
  const docs = await listDocumentsInFolders(organizationId, root.projectId, folderIds)
  const at = new Date()

  const answers = await findAnswersDrawingOn(
    organizationId,
    root.projectId,
    docs.map((doc) => ({ id: doc.id, collectionName: doc.collectionName, filename: doc.filename })),
    root.id
  )
  const conversationIds = [...new Set(answers.map((answer) => answer.conversationId))]
  const messageIds = answers.map((answer) => answer.messageId)
  await recordFolderOnConversations(organizationId, conversationIds, root.id)
  await markAnswersSourceDeleted(organizationId, messageIds, root.id, at)
  const reports = await listReportsDerivedFrom(organizationId, conversationIds, messageIds)
  await markReportsSourceDeleted(organizationId, reports.map((report) => report.id), root.id, at)

  let memoryIds: string[] = []
  let replaced = 0
  if (removeDerived) {
    memoryIds = await deleteMemoryDrawnFrom(organizationId, root.projectId, folderIds, conversationIds)
    replaced = await replaceRemovedAnswers(organizationId, messageIds, root.id, at)
    await mergeBinEntryPayload(organizationId, root.id, {
      derivedRemoval: {
        removedAt: previous?.removedAt ?? at.toISOString(),
        conversationIds: [...new Set([...(previous?.conversationIds ?? []), ...conversationIds])],
        messageIds: [...new Set([...(previous?.messageIds ?? []), ...messageIds])],
        memoryIds: [...new Set([...(previous?.memoryIds ?? []), ...memoryIds])],
        reportIds: [...new Set([...(previous?.reportIds ?? []), ...reports.map((report) => report.id)])],
      },
    })
  }

  await inPool(docs, ERASE_CONCURRENCY, (doc) => eraseProjectDocument(doc, organizationId))
  const folders = await withTenant({ organizationId }, () => markFoldersPurged(db, root.projectId, root.id, at))

  const counts: FolderPurgeCounts = {
    documents: docs.length,
    folders: Math.max(folders, folderIds.length),
    memoryNotes: memoryIds.length,
    answers: removeDerived ? replaced : messageIds.length,
    conversations: conversationIds.length,
    reports: reports.length,
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
  input: { projectId: string; folderId: string },
  request?: Request
): Promise<FolderPurgeResult> {
  await requireProjectAccess(session, input.projectId, 'project:manage')
  const { project, root } = await binEntryFor(session, input.projectId, input.folderId)
  await assertNoActiveHold(session.organizationId, 'folder', root.id)
  const claim = await claimBinEntryNow(session.organizationId, root.id)
  if (!claim) throw new ConflictError('This folder is already being deleted.')
  const result = await purgeClaimedNow(session.organizationId, root.id, claim)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'project.folder.purged',
    targetType: 'project',
    targetId: project.id,
    metadata: { folderId: root.id, documents: result.counts.documents, folders: result.counts.folders },
    request,
  })
  return result
}
