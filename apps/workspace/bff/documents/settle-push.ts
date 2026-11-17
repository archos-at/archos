import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import type { Document } from '@/lib/db/schema/documents'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'
import { reconcileDocumentStatuses } from './reconcile-status'
import { listSettleableDocumentsForIngestJobs } from './repository'

export interface SettlePushResult {
  settled: number
}

const byOrganization = (rows: Document[]): Map<string, Document[]> => {
  const grouped = new Map<string, Document[]>()
  for (const row of rows) grouped.set(row.organizationId, [...(grouped.get(row.organizationId) ?? []), row])
  return grouped
}

export async function settlePushedIngestJobs(jobIds: readonly string[]): Promise<SettlePushResult> {
  const rows = await listSettleableDocumentsForIngestJobs([...new Set(jobIds)])
  let settled = 0
  for (const [organizationId, inOrganization] of byOrganization(rows)) {
    try {
      const reconciled = await withTenant({ organizationId }, () =>
        reconcileDocumentStatuses(inOrganization, organizationId, 'push')
      )
      settled += reconciled.filter((row) => !IN_FLIGHT_DOCUMENT_STATUSES.has(row.status)).length
    } catch (error) {
      console.warn(`[ingest] settle push could not reconcile ${inOrganization.length} document(s):`, error)
    }
  }
  return { settled }
}
