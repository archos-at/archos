/**
 * The settle push: the ingest worker says which jobs ended, and their documents
 * are settled now instead of when somebody next reads a list.
 *
 * Nothing new decides anything here. The rows are found by their recorded job
 * id (`listInFlightDocumentsForIngestJobs`) and handed to the same
 * `reconcileDocumentStatuses` every read and sweep uses, inside their own
 * organization, so the guarded write, the once-only settle of the upload batch
 * and the once-only `document_ingest_finished` all hold as they do for a read.
 * The reconcile still asks the backend for each job's status: the push is a
 * hint about WHEN to look, never a claim about what the job did.
 *
 * Best effort on both sides. The worker logs a failed push and goes on; the
 * upload sweep (`lib/upload-batches/sweep.ts`) and the next read stay the
 * fallback, and a push for a job whose row already came to rest finds no row.
 */

import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import type { Document } from '@/lib/db/schema/documents'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'
import { reconcileDocumentStatuses } from './reconcile-status'
import { listInFlightDocumentsForIngestJobs } from './repository'

export interface SettlePushResult {
  /** Rows found in flight for the named jobs that the reconcile left at rest. */
  settled: number
}

const byOrganization = (rows: Document[]): Map<string, Document[]> => {
  const grouped = new Map<string, Document[]>()
  for (const row of rows) grouped.set(row.organizationId, [...(grouped.get(row.organizationId) ?? []), row])
  return grouped
}

/** Settle the documents of the ingest jobs `jobIds`. An id no in-flight row carries is ignored. */
export async function settlePushedIngestJobs(jobIds: readonly string[]): Promise<SettlePushResult> {
  const rows = await listInFlightDocumentsForIngestJobs([...new Set(jobIds)])
  let settled = 0
  for (const [organizationId, inOrganization] of byOrganization(rows)) {
    try {
      const reconciled = await withTenant({ organizationId }, () =>
        reconcileDocumentStatuses(inOrganization, organizationId, 'push')
      )
      settled += reconciled.filter((row) => !IN_FLIGHT_DOCUMENT_STATUSES.has(row.status)).length
    } catch (error) {
      // One organization's failure must not cost the others their settle; the sweep retries it.
      console.warn(`[ingest] settle push could not reconcile ${inOrganization.length} document(s):`, error)
    }
  }
  return { settled }
}
