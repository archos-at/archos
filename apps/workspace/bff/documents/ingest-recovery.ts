import 'server-only'
import { hasPermission, ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { ForbiddenError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import { INGEST_ALREADY_DONE, INGEST_NOT_ELIGIBLE, INGEST_RUNNING, INGEST_WOULD_FAIL_AGAIN } from './reingest-codes'
import type { AuthorizedSession } from '@/lib/auth/types'
import { resolveDocumentFolderPath } from './folder-path'
import { collectionFileRef } from './collection-file-ref'
import { findDocumentInOrg, markDocumentIngestFailed, listFailedDocumentPageInOrg } from './repository'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import { emptyCounts, recordJobFailure, requesterOf, type JobCounts, type JobSliceResult, type ReingestFailedPayload } from '@/lib/jobs-queue/types'
import { internalRead } from './document-reader'
import { dispatchDocument } from './document-dispatch'
import { INGEST_DISPATCH_FAILED_MESSAGE } from './ingest-dispatch'
import { REINDEX_CONCURRENCY, forEachBounded } from './reindex'
import { reingestDocument } from './reingest'

export interface ReingestFailedOrgResult {
  jobId: string
}

export const REINGEST_SLICE_DOCUMENTS = 25

function reingestRefusalCode(error: unknown): string | null {
  if (error instanceof ConflictError) {
    const details = error.details as { code?: unknown } | undefined
    return typeof details?.code === 'string' ? details.code : null
  }
  return null
}

export async function reingestFailedOrgDocuments(
  session: AuthorizedSession
): Promise<ReingestFailedOrgResult> {
  const open = await findOpenJobId({
    kind: 'reingest_failed',
    organizationId: session.organizationId,
    matching: {},
  })
  if (open) return { jobId: open }

  const payload: ReingestFailedPayload = {
    requester: requesterOf(session),
    cursor: null,
    counts: emptyCounts(),
  }
  const { jobId } = await enqueueJob({
    kind: 'reingest_failed',
    organizationId: session.organizationId,
    payload,
  })
  return { jobId }
}

async function retryFailedDocument(
  session: AuthorizedSession,
  id: string
): Promise<'queued' | 'skipped' | 'failed'> {
  try {
    const outcome = await reingestDocument(session, id, { priority: 'bulk' })
    return outcome.status === 'failed' ? 'failed' : 'queued'
  } catch (error) {
    const code = reingestRefusalCode(error)
    if (
      code === INGEST_RUNNING ||
      code === INGEST_ALREADY_DONE ||
      code === INGEST_NOT_ELIGIBLE ||
      code === INGEST_WOULD_FAIL_AGAIN
    ) {
      return 'skipped'
    }
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return 'skipped'
    return 'failed'
  }
}

export async function runReingestFailedSlice(
  session: AuthorizedSession,
  payload: ReingestFailedPayload
): Promise<JobSliceResult<ReingestFailedPayload>> {
  if (!hasPermission(session, ORG_PERMISSIONS.settingsManage)) {
    console.warn(`[reingest] ${session.userId} no longer holds ${ORG_PERMISSIONS.settingsManage}; stopping the rescan`)
    return { done: true, payload }
  }

  const { ids, nextCursor } = await listFailedDocumentPageInOrg(session.organizationId, {
    limit: REINGEST_SLICE_DOCUMENTS,
    cursor: payload.cursor,
  })

  const counts: JobCounts = { ...payload.counts, failedNames: [...payload.counts.failedNames] }
  await forEachBounded(ids, REINDEX_CONCURRENCY, async (id) => {
    const outcome = await retryFailedDocument(session, id)
    if (outcome === 'failed') recordJobFailure(counts, id)
    else counts[outcome] += 1
  })

  const next = { ...payload, cursor: nextCursor, counts }
  if (nextCursor) return { done: false, payload: next }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.documents.reingested',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: {
      total: counts.queued + counts.skipped + counts.failed,
      queued: counts.queued,
      skipped: counts.skipped,
      failed: counts.failed,
      truncated: false,
    },
  })
  return { done: true, payload: next }
}

export type StuckDocumentOutcome = 'requeued' | 'failed' | 'gone'

export async function redispatchStuckDocument(
  organizationId: string,
  documentId: string
): Promise<StuckDocumentOutcome> {
  const doc = await findDocumentInOrg(documentId, organizationId, internalRead('ingest'))
  if (!doc || doc.status !== 'processing') return 'gone'

  if (!doc.storageKey || doc.authoredBy !== 'user' || !collectionFileRef(doc)) {
    await markDocumentIngestFailed(doc.id, organizationId, INGEST_DISPATCH_FAILED_MESSAGE)
    return 'failed'
  }
  const { status } = await dispatchDocument({
    organizationId,
    projectId: doc.projectId,
    documentId: doc.id,
    filename: doc.filename,
    storageKey: doc.storageKey,
    storageBucket: doc.storageBucket,
    collectionName: doc.collectionName,
    folderPath: await resolveDocumentFolderPath(doc, organizationId),
    priority: 'bulk',
  })
  return status === 'failed' ? 'failed' : 'requeued'
}
