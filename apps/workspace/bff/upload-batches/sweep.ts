import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { reconcileDocumentStatuses } from '@/lib/documents/reconcile-status'
import { pruneSpentQuarantines, sweepOwedQuarantines } from '@/lib/upload-screening/quarantine-audit'
import type { UploadBatch } from '@/lib/db/schema/upload-batches'
import {
  latestBatchDocumentAt,
  listInFlightBatchDocuments,
  listOpenBatchesBetween,
  sealAbandonedBatch,
} from './repository'
import { settleUploadBatches } from './settle'

const SETTLE_GRACE_MS = 60_000
export const ABANDONED_AFTER_MS = 30 * 60_000
const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60_000
export const MAX_SWEEP_WINDOW_DAYS = 60
export const SWEEP_BATCH = 25

export interface UploadSweepResult {
  checked: number
  sealed: number
  completed: number
  failed: number
  audited: number
  pruned: number
}

export async function sweepUploadBatches(
  now: Date = new Date(),
  windowMs: number = SWEEP_WINDOW_MS
): Promise<UploadSweepResult> {
  const open = await listOpenBatchesBetween(
    new Date(now.getTime() - windowMs),
    new Date(now.getTime() - SETTLE_GRACE_MS),
    SWEEP_BATCH
  )
  const result: UploadSweepResult = {
    checked: open.length,
    sealed: 0,
    completed: 0,
    failed: 0,
    audited: 0,
    pruned: 0,
  }
  for (const batch of open) {
    try {
      await withTenant({ organizationId: batch.organizationId }, async () => {
        if (!batch.sealedAt && (await isAbandoned(batch, now))) {
          await sealAbandonedBatch(batch.organizationId, batch.id, now)
          result.sealed += 1
        }
        const inFlight = await listInFlightBatchDocuments(batch.organizationId, batch.id)
        if (inFlight.length > 0) await reconcileDocumentStatuses(inFlight, batch.organizationId, 'sweep')
        const completed = await settleUploadBatches(batch.organizationId, [batch.id])
        result.completed += completed.length
      })
    } catch (error) {
      result.failed += 1
      console.warn(`[upload-batches] sweep could not settle batch ${batch.id}:`, error)
    }
  }
  try {
    result.audited = await sweepOwedQuarantines(now)
  } catch (error) {
    console.warn('[upload-batches] sweep could not list the owed quarantine decisions:', error)
  }
  try {
    result.pruned = await pruneSpentQuarantines(now)
  } catch (error) {
    console.warn('[upload-batches] sweep could not delete the spent quarantine decisions:', error)
  }
  return result
}

async function isAbandoned(batch: UploadBatch, now: Date): Promise<boolean> {
  const idleSince = (at: Date) => now.getTime() - at.getTime() > ABANDONED_AFTER_MS
  if (!idleSince(new Date(batch.createdAt))) return false
  const latest = await latestBatchDocumentAt(batch.organizationId, batch.id)
  return latest === null || idleSince(latest)
}
