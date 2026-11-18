import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { INGEST_DISPATCH_FAILED_MESSAGE } from './ingest-dispatch'
import { redispatchStuckDocument } from './ingest-recovery'
import { listStuckProcessingDocuments, markDocumentIngestFailed, type StuckProcessingDocument } from './repository'

export const STUCK_AFTER_MINUTES = 15

export const STUCK_BATCH = 50

export interface StuckProcessingSweepResult {
  checked: number
  requeued: number
  failed: number
  gone: number
  errors: number
}

async function recoverOne(row: StuckProcessingDocument): Promise<'requeued' | 'failed' | 'gone'> {
  if (row.jobStatus === 'dead') {
    const failed = await markDocumentIngestFailed(row.id, row.organizationId, INGEST_DISPATCH_FAILED_MESSAGE, {
      backgroundJobId: row.jobId,
    })
    if (!failed) return 'gone'
    console.warn(`[documents] ${row.id} failed every attempt of its background job: ${row.lastError ?? 'no reason kept'}`)
    return 'failed'
  }
  return redispatchStuckDocument(row.organizationId, row.id)
}

async function recoverRows(rows: StuckProcessingDocument[]): Promise<StuckProcessingSweepResult> {
  const result: StuckProcessingSweepResult = { checked: rows.length, requeued: 0, failed: 0, gone: 0, errors: 0 }
  for (const row of rows) {
    try {
      const outcome = await withTenant({ organizationId: row.organizationId }, () => recoverOne(row))
      result[outcome] += 1
    } catch (error) {
      console.error('[documents] could not recover document', row.id, 'left at processing', error)
      result.errors += 1
    }
  }
  return result
}

export async function recoverStuckProcessing(
  now: Date = new Date(),
  options: { staleMinutes?: number; batch?: number } = {}
): Promise<StuckProcessingSweepResult> {
  const before = new Date(now.getTime() - (options.staleMinutes ?? STUCK_AFTER_MINUTES) * 60_000)
  return recoverRows(await listStuckProcessingDocuments(before, options.batch ?? STUCK_BATCH))
}

export async function failDocumentsOfDeadJob(jobId: string): Promise<StuckProcessingSweepResult> {
  return recoverRows(await listStuckProcessingDocuments({ deadJobId: jobId }, STUCK_BATCH))
}
