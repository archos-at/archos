import 'server-only'
import { requireProjectAccess } from '@/lib/authz/projects'
import { ForbiddenError } from '@/lib/api/errors'
import { NotFoundError } from '@/lib/api/errors'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'
import type { AuthorizedSession } from '@/lib/auth/types'
import { resolveDocumentFolderPath } from './folder-path'
import { collectionFileRef } from './collection-file-ref'
import { listProjectDocumentPage, type DocumentListRow } from './repository'
import { documentDisplayName } from './display-name'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import { emptyCounts, recordJobFailure, requesterOf, type JobCounts, type JobSliceResult, type ReindexProjectPayload } from '@/lib/jobs-queue/types'
import { getAccessibleDocument } from './access'
import { internalRead } from './document-reader'
import { dispatchDocument } from './document-dispatch'

export interface ReindexProjectResult {
  projectId: string
  jobId: string
}

export const REINDEX_SLICE_DOCUMENTS = 25

export const REINDEX_CONCURRENCY = 4

export async function forEachBounded<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await work(items[next++])
  })
  await Promise.all(workers)
}

export async function reindexProject(
  session: AuthorizedSession,
  projectId: string
): Promise<ReindexProjectResult> {
  await requireProjectAccess(session, projectId, ['project:documents:write', 'project:edit'])

  const open = await findOpenJobId({
    kind: 'reindex_project',
    organizationId: session.organizationId,
    matching: { projectId },
  })
  if (open) return { projectId, jobId: open }

  const payload: ReindexProjectPayload = {
    projectId,
    requester: requesterOf(session),
    cursor: null,
    counts: emptyCounts(),
  }
  const { jobId } = await enqueueJob({
    kind: 'reindex_project',
    organizationId: session.organizationId,
    payload,
  })
  return { projectId, jobId }
}

async function redispatchForReindex(
  session: AuthorizedSession,
  row: DocumentListRow
): Promise<'queued' | 'skipped'> {
  const doc = await getAccessibleDocument(session, row.id, 'write')
  if (!doc.storageKey || IN_FLIGHT_DOCUMENT_STATUSES.has(doc.status) || doc.status === 'quarantined') return 'skipped'

  if (!collectionFileRef(doc)) return 'skipped'

  const { status } = await dispatchDocument({
    organizationId: session.organizationId,
    projectId: doc.projectId,
    documentId: doc.id,
    filename: doc.filename,
    storageKey: doc.storageKey,
    storageBucket: doc.storageBucket,
    collectionName: doc.collectionName,
    folderPath: await resolveDocumentFolderPath(doc, session.organizationId),
    priority: 'bulk',
  })
  if (status === 'failed') throw new Error('dispatch failed')
  return 'queued'
}

export async function runReindexSlice(
  session: AuthorizedSession,
  payload: ReindexProjectPayload
): Promise<JobSliceResult<ReindexProjectPayload>> {
  try {
    await requireProjectAccess(session, payload.projectId, ['project:documents:write', 'project:edit'])
  } catch (error) {
    if (!(error instanceof NotFoundError) && !(error instanceof ForbiddenError)) throw error
    console.warn(`[reindex] project ${payload.projectId}: the requester no longer has access; stopping`)
    return { done: true, payload }
  }

  const { rows, nextCursor } = await listProjectDocumentPage(payload.projectId, session.organizationId, {
    reader: internalRead('ingest'),
    authoredBy: 'user',
    cursor: payload.cursor ?? undefined,
    limit: REINDEX_SLICE_DOCUMENTS,
  })

  const counts: JobCounts = { ...payload.counts, failedNames: [...payload.counts.failedNames] }
  await forEachBounded(rows, REINDEX_CONCURRENCY, async (row) => {
    try {
      const outcome = await redispatchForReindex(session, row)
      counts[outcome] += 1
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ForbiddenError) {
        counts.skipped += 1
        return
      }
      recordJobFailure(counts, documentDisplayName(row))
    }
  })

  const next = { ...payload, cursor: nextCursor, counts }
  if (!nextCursor) logReindexSummary(next)
  return { done: !nextCursor, payload: next }
}

function logReindexSummary(payload: ReindexProjectPayload): void {
  const { queued, skipped, failed, failedNames } = payload.counts
  const line =
    `[reindex] project ${payload.projectId}: ${queued} re-dispatched, ${skipped} skipped, ${failed} failed` +
    (failed > 0 ? ` (${failedNames.join(', ')}${failed > failedNames.length ? ', …' : ''})` : '')
  if (failed > 0) console.warn(line)
  else console.debug(line)
}
