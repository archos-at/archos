import 'server-only'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { UploadBatch } from '@/lib/db/schema/upload-batches'
import { memberReader } from '@/lib/documents/document-reader'
import { listBatchDocuments } from './repository'
import { reportSaysSomething, uploadReport, type UploadReport } from './upload-report'

export const UPLOAD_REPORT_TIMEOUT_MS = 4_000

async function computeUploadReport(batch: UploadBatch, projectId: string): Promise<UploadReport | null> {
  const session = await resolvePinnedRequesterSession({
    userId: batch.createdBy,
    email: null,
    organizationId: batch.organizationId,
  })
  if (!session) return null
  const rows = await listBatchDocuments(batch.organizationId, batch.id, memberReader(batch.createdBy))
  const batchIds = new Set(rows.map((row) => row.id))
  if (batchIds.size === 0) return null
  const { readProjectFindingsInput } = await import('@/lib/documents/findings-service')
  const { documents, profile } = await readProjectFindingsInput(session, projectId)
  const batchDocuments = documents.filter((document) => batchIds.has(document.id))
  if (batchDocuments.length === 0) return null
  const summary = uploadReport(batchDocuments, documents, profile)
  return reportSaysSomething(summary) ? { projectId, ...summary } : null
}

export async function uploadReportFor(batch: UploadBatch): Promise<UploadReport | null> {
  if (batch.scope !== 'project' || !batch.projectId) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[upload-batches] the report of batch ${batch.id} took too long; its row goes out without one`)
      resolve(null)
    }, UPLOAD_REPORT_TIMEOUT_MS)
  })
  const report = computeUploadReport(batch, batch.projectId).catch((error: unknown) => {
    console.warn(`[upload-batches] the report of batch ${batch.id} failed; its row goes out without one:`, error)
    return null
  })
  try {
    return await Promise.race([report, timeout])
  } finally {
    clearTimeout(timer)
  }
}
