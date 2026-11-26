import 'server-only'
import { randomUUID } from 'node:crypto'
import { ConflictError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import { atLeast, folderReadOnlyError } from '@/lib/authz/folder-access'
import { getBackendUrl } from '@/lib/backend-proxy'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import { withTenant } from '@/lib/db/tenant-context'
import type { Document } from '@/lib/db/schema/documents'
import { computePurgeAfter, folderGraceDays } from '@/lib/deletion/policy'
import { collectionFileRef, purgeIngestedChunks } from '@/lib/documents/collection-file-ref'
import { shelfProjectId, type SharedShelf } from '@/lib/documents/shelf'
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
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { inPool } from '@/lib/utils/in-pool'
import { decodeDocumentListCursor, encodeDocumentListCursor } from '@/lib/documents/list-cursor'
import { binEntryFor, binPolicyOf } from './bin-shelf'
import {
  closeBinEntryRestored,
  findFolderInOrg,
  findLivingFolder,
  insertFolderBinEntry,
  listBinEntries,
  listDocumentIdsInFolders,
  listDocumentsInFolders,
  listLivingSubtree,
  markDocumentsRestoring,
  markFoldersBinned,
  mergeBinEntryPayload,
  rehomeFolder,
  takeBinLock,
  unbinFolders,
  type BinFolderRow,
  type FolderBinPayload,
} from './folder-bin-repository'
import { FOLDER_NAME_TAKEN_REASON } from './folder-bin-codes'
import { BIN_PAGE_SIZE, type BinListQuery, type RestoreBlocked } from './folder-bin-wire'
import { buildFolderPath } from './folders'

export { FOLDER_CONTENTS_PROTECTED_REASON } from './bin-shelf'
export { FolderNotInBinError, purgeBinnedFolder, purgeFolderFromBinNow, type FolderPurgeResult } from './folder-bin-purge'
export { FOLDER_NAME_TAKEN_REASON }

const CHUNK_PURGE_TIMEOUT_MS = 15_000
export const BACKEND_CONCURRENCY = 8

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

export type FolderBinAuditAction =
  | 'project.folder.binned'
  | 'project.folder.restored'
  | 'project.folder.purged'
  | 'office_shelf.folder.binned'
  | 'office_shelf.folder.restored'
  | 'office_shelf.folder.purged'

export interface ShelfFolderRef {
  shelf: SharedShelf
  folderId: string
}

export async function moveFolderToBin(
  session: AuthorizedSession,
  input: ShelfFolderRef,
  request?: Request,
  options: BinOptions = {}
): Promise<BinFolderResult> {
  const { organizationId } = session
  const { shelf } = input
  const policy = binPolicyOf(shelf)
  await policy.assertMayDelete(session)
  const db = getDb()
  const root = await withTenant({ organizationId }, () => findFolderInOrg(db, shelf, organizationId, input.folderId))
  if (!root || root.deletedAt) throw new NotFoundError('Folder not found')

  const checked = await withTenant({ organizationId }, () => listLivingSubtree(db, shelf, organizationId, root.id))
  await policy.assertMayBinSubtree(session, root, checked)

  const purgeAfter = options.purgeAfter ?? computePurgeAfter(new Date(), folderGraceDays())
  const at = new Date()
  const purgeJobId = randomUUID()
  const requester = requesterOf(session)
  const projectId = shelfProjectId(shelf)
  const folderIds = await withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      await takeBinLock(tx, shelf, organizationId)
      const subtree = await listLivingSubtree(tx, shelf, organizationId, root.id)
      if (subtree.length === 0) throw new NotFoundError('Folder not found')
      const known = new Set(checked)
      if (subtree.some((folderId) => !known.has(folderId))) {
        throw new ConflictError('The folder changed while it was being deleted. Please try again.')
      }
      if (options.onlyDocuments) {
        const held = await listDocumentIdsInFolders(tx, shelf, organizationId, subtree)
        const expected = new Set(options.onlyDocuments)
        if (held.length !== expected.size || held.some((id) => !expected.has(id))) {
          throw new ConflictError('The folder changed while it was being deleted. Please try again.', {
            reason: FOLDER_CONTENTS_CHANGED_REASON,
          })
        }
      }
      await markFoldersBinned(tx, shelf, organizationId, { folderIds: subtree, rootId: root.id, deletedBy: session.userId, at })
      const payload: FolderBinPayload = {
        projectId,
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
      const takeover: PurgeBinnedChunksPayload = { projectId, folderId: root.id, entryId, requester, cursor: null, documents: 0 }
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
  publishShelfChanged(organizationId, shelf, { folders: true })

  const docs = await listDocumentsInFolders(organizationId, shelf, folderIds)
  const purged = await inPool(docs, BACKEND_CONCURRENCY, purgeChunksOf)
  if (purged.some((ok) => !ok)) {
    try {
      await returnFromBin(organizationId, shelf, root.id, requester)
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

  const audit = policy.audit(organizationId)
  await recordAuditEvent({
    organizationId,
    actor: { userId: session.userId, email: session.email },
    action: audit.binned,
    targetType: audit.targetType,
    targetId: audit.targetId,
    metadata: { folderId: root.id, documents: docs.length, folders: folderIds.length, purgeAfter: purgeAfter.toISOString() },
    request,
  })
  return { documentsBinned: docs.length, foldersBinned: folderIds.length, purgeAfter }
}

export type RestoredTo = 'original' | 'root'

async function unbinEntry(
  organizationId: string,
  root: BinFolderRow,
  requester: JobRequester
): Promise<{ restoredTo: RestoredTo; folders: number; documents: number }> {
  const { shelf } = root
  const db = getDb()
  const at = new Date()
  const jobId = randomUUID()
  try {
    const restored = await withTenant({ organizationId }, () =>
      db.transaction(async (tx) => {
        await takeBinLock(tx, shelf, organizationId)
        if (!(await closeBinEntryRestored(tx, organizationId, root.id))) {
          throw new ConflictError('This folder can no longer be restored: its final deletion has started.')
        }
        const parent = root.parentId ? await findLivingFolder(tx, shelf, organizationId, root.parentId) : null
        const restoredTo: RestoredTo = root.parentId && !parent ? 'root' : 'original'
        const folderIds = await unbinFolders(tx, shelf, organizationId, root.id, at)
        const newPath = buildFolderPath(parent?.path ?? '', root.name)
        await rehomeFolder(tx, root, { parentId: parent?.id ?? null, newPath, at })
        const documents = await markDocumentsRestoring(tx, shelf, organizationId, { folderIds, jobId, at })
        if (documents > 0) {
          const payload: RestoreFolderBinPayload = {
            projectId: shelfProjectId(shelf),
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
    publishShelfChanged(organizationId, shelf, { folders: true })
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
  shelf: SharedShelf,
  rootId: string,
  requester: JobRequester
): Promise<void> {
  const root = await withTenant({ organizationId }, () => findFolderInOrg(getDb(), shelf, organizationId, rootId))
  if (!root) return
  await unbinEntry(organizationId, root, requester)
}

export interface RestoreFolderResult {
  restoredTo: RestoredTo
  folders: number
  documents: number
}

export async function restoreFolderFromBin(
  session: AuthorizedSession,
  input: ShelfFolderRef,
  request?: Request
): Promise<RestoreFolderResult> {
  const { root, access, policy } = await binEntryFor(session, input.shelf, input.folderId)
  if (access.levelOf(root.id) !== 'write' || !(await access.mayRestore())) throw folderReadOnlyError()

  const { restoredTo, folders, documents } = await unbinEntry(session.organizationId, root, requesterOf(session))

  const audit = policy.audit(session.organizationId)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: audit.restored,
    targetType: audit.targetType,
    targetId: audit.targetId,
    metadata: { folderId: root.id, documents, folders, restoredTo },
    request,
  })
  return { restoredTo, folders, documents }
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
  restoreBlocked: RestoreBlocked | null
  document: { id: string; name: string } | null
}

export interface FolderBinListing {
  entries: FolderBinEntry[]
  canPurge: boolean
  nextCursor: string | null
}

export async function listFolderBin(
  session: AuthorizedSession,
  shelf: SharedShelf,
  query: BinListQuery = {}
): Promise<FolderBinListing> {
  const access = await binPolicyOf(shelf).access(session)
  const cursor = query.cursor ? decodeDocumentListCursor(query.cursor) : null
  const reader = await shelfReaderFor(session, { scope: shelf.kind, projectId: shelfProjectId(shelf) })
  const [page, mayRestore, canPurge, directory] = await Promise.all([
    listBinEntries(session.organizationId, shelf, reader, {
      limit: query.limit ?? BIN_PAGE_SIZE,
      ...(cursor ? { cursor: { deletedAt: cursor.createdAt, folderId: cursor.id } } : {}),
    }),
    access.mayRestore(),
    access.mayPurge(),
    loadOrganizationDirectory(session.organizationId),
  ])
  const entries = page.rows.flatMap((row): FolderBinEntry[] => {
    const level = access.levelOf(row.folderId)
    if (!atLeast(level, 'read')) return []
    const person = row.deletedBy ? directory.get(row.deletedBy) : undefined
    const pending = row.status === 'pending'
    return [
      {
        ...row,
        deletedBy: { userId: row.deletedBy, name: person?.name ?? person?.email ?? null },
        canRestore: pending && level === 'write' && mayRestore,
        restoreBlocked: !pending ? null : level !== 'write' ? 'folder_read_only' : mayRestore ? null : access.restoreBlocked,
      },
    ]
  })
  const nextCursor = page.nextCursor
    ? encodeDocumentListCursor({ createdAt: page.nextCursor.deletedAt, id: page.nextCursor.folderId })
    : null
  return { entries, canPurge, nextCursor }
}
