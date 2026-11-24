import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getDb } from '@/lib/db'
import type { Document } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { collectionFileRef } from '@/lib/documents/collection-file-ref'
import { resolveDocumentFolderPath } from '@/lib/documents/folder-path'
import { redispatchPublishedVersion } from '@/lib/documents/lifecycle'
import { markDocumentIngestFailed } from '@/lib/documents/repository'
import { dispatchDocument } from '@/lib/documents/document-dispatch'
import { INGEST_DISPATCH_FAILED_MESSAGE } from '@/lib/documents/ingest-dispatch'
import { shelfProjectId, type SharedShelf } from '@/lib/documents/shelf'
import {
  recordJobFailure,
  type JobAttempt,
  type JobCounts,
  type JobSliceResult,
  type PurgeBinnedChunksPayload,
  type RestoreFolderBinPayload,
} from '@/lib/jobs-queue/types'
import { inPool } from '@/lib/utils/in-pool'
import { binPolicyOf, shelfOfBinPayload } from './bin-shelf'
import { BACKEND_CONCURRENCY, purgeChunksOf, returnFromBin } from './folder-bin'
import {
  findBinEntryById,
  findFolderInOrg,
  listDocumentPageInFolders,
  listEntryFolderIds,
  listRestoringDocumentPage,
  mergeBinEntryPayload,
  setDocumentCollection,
  type FolderBinPayload,
} from './folder-bin-repository'

export const RESTORE_SLICE_DOCUMENTS = 25
const RESTORE_CONCURRENCY = 4
export const PURGE_SLICE_DOCUMENTS = 50

async function reingestRestored(
  organizationId: string,
  shelf: SharedShelf,
  target: string,
  doc: Document
): Promise<'queued' | 'failed'> {
  if (target !== doc.collectionName) await setDocumentCollection(organizationId, doc.id, target)
  const placed = { ...doc, collectionName: target }
  if (!collectionFileRef(placed) || !doc.storageKey) {
    await markDocumentIngestFailed(doc.id, organizationId, INGEST_DISPATCH_FAILED_MESSAGE)
    return 'failed'
  }
  try {
    const { status } =
      doc.authoredBy === 'user'
        ? await dispatchDocument({
            organizationId,
            projectId: shelfProjectId(shelf),
            documentId: doc.id,
            filename: doc.filename,
            storageKey: doc.storageKey,
            storageBucket: doc.storageBucket,
            collectionName: target,
            folderPath: await resolveDocumentFolderPath(placed, organizationId),
            priority: 'bulk',
          })
        : await redispatchPublishedVersion(organizationId, placed, 'bulk')
    return status === 'failed' ? 'failed' : 'queued'
  } catch (error) {
    console.warn(`[folder-bin] re-ingest of ${doc.id} after restore failed:`, error)
    await markDocumentIngestFailed(doc.id, organizationId, INGEST_DISPATCH_FAILED_MESSAGE)
    return 'failed'
  }
}

export async function runRestoreFolderSlice(
  session: AuthorizedSession,
  payload: RestoreFolderBinPayload
): Promise<JobSliceResult<RestoreFolderBinPayload>> {
  const { organizationId } = session
  const shelf = shelfOfBinPayload(payload)
  const policy = binPolicyOf(shelf)
  if (!(await policy.requesterMayRestore(session))) {
    console.warn(`[folder-bin] restore of ${payload.folderId}: the requester no longer has access; stopping`)
    return { done: true, payload }
  }

  const rows = await listRestoringDocumentPage(organizationId, shelf, payload.jobId, payload.cursor, RESTORE_SLICE_DOCUMENTS)
  const counts: JobCounts = { ...payload.counts, failedNames: [...payload.counts.failedNames] }
  if (rows.length > 0) {
    const collectionFor = await policy.collectionFor(organizationId).catch((error: unknown) => {
      if (error instanceof NotFoundError) return null
      throw error
    })
    if (!collectionFor) return { done: true, payload }
    await inPool(rows, RESTORE_CONCURRENCY, async (doc) => {
      const outcome = await reingestRestored(organizationId, shelf, collectionFor(doc), doc)
      if (outcome === 'failed') recordJobFailure(counts, doc.id)
      else counts.queued += 1
    })
  }

  const next: RestoreFolderBinPayload = { ...payload, cursor: rows.at(-1)?.id ?? payload.cursor, counts }
  const done = rows.length < RESTORE_SLICE_DOCUMENTS
  if (done && counts.failed > 0) {
    console.warn(
      `[folder-bin] restore of ${payload.folderId}: ${counts.queued} re-dispatched, ${counts.failed} failed (${counts.failedNames.join(', ')})`
    )
  }
  return { done, payload: next }
}

export async function runPurgeBinnedChunksSlice(
  organizationId: string,
  payload: PurgeBinnedChunksPayload,
  attempt: JobAttempt
): Promise<JobSliceResult<PurgeBinnedChunksPayload>> {
  const finished = { done: true, payload }
  const entry = await findBinEntryById(organizationId, payload.entryId)
  const recorded = (entry?.payload ?? null) as Partial<FolderBinPayload> | null
  if (!entry || entry.status !== 'pending' || recorded?.chunksPurgedAt) return finished
  const db = getDb()
  const shelf = shelfOfBinPayload(payload)
  const root = await withTenant({ organizationId }, () => findFolderInOrg(db, shelf, organizationId, payload.folderId))
  if (!root || !root.deletedAt || root.purgedAt || root.binRootId !== root.id) return finished

  const folderIds = await withTenant({ organizationId }, () => listEntryFolderIds(db, root))
  const page = await listDocumentPageInFolders(organizationId, shelf, folderIds, payload.cursor, PURGE_SLICE_DOCUMENTS)
  const confirmed = await inPool(page, BACKEND_CONCURRENCY, purgeChunksOf)
  const refused = confirmed.filter((ok) => !ok).length
  if (refused > 0) {
    if (!attempt.last) {
      throw new Error(`the search index did not confirm the chunk purge of ${refused} document(s) of binned folder ${root.id}`)
    }
    await returnFromBin(organizationId, shelf, root.id, payload.requester)
    console.error(`[folder-bin] the index refused the chunk purge of binned folder ${root.id} on every attempt; the delete was undone`)
    return finished
  }

  const next: PurgeBinnedChunksPayload = {
    ...payload,
    cursor: page.at(-1)?.id ?? payload.cursor,
    documents: payload.documents + page.length,
  }
  if (page.length === PURGE_SLICE_DOCUMENTS) return { done: false, payload: next }
  await mergeBinEntryPayload(organizationId, root.id, { chunksPurgedAt: new Date().toISOString(), documents: next.documents })
  console.warn(`[folder-bin] finished the chunk purge of binned folder ${root.id}, which its delete request left unfinished`)
  return { done: true, payload: next }
}
