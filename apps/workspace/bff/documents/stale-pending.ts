import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { reconcileDocumentStatuses } from './reconcile-status'
import { listStalePendingDocuments } from './repository'

export const STALE_PENDING_AFTER_MINUTES = 5
export const STALE_PENDING_BATCH = 200

export interface StalePendingSweepResult {
  checked: number
  organizations: number
  errors: number
}

export async function reconcileStalePending(now: Date = new Date()): Promise<StalePendingSweepResult> {
  const before = new Date(now.getTime() - STALE_PENDING_AFTER_MINUTES * 60_000)
  const rows = await listStalePendingDocuments(before, STALE_PENDING_BATCH)
  const byOrganization = new Map<string, typeof rows>()
  for (const row of rows) byOrganization.set(row.organizationId, [...(byOrganization.get(row.organizationId) ?? []), row])

  const result: StalePendingSweepResult = { checked: rows.length, organizations: byOrganization.size, errors: 0 }
  for (const [organizationId, group] of byOrganization) {
    try {
      await withTenant({ organizationId }, () => reconcileDocumentStatuses(group, organizationId, 'sweep'))
    } catch (error) {
      console.error('[documents] could not read back pending ingests of', organizationId, error)
      result.errors += 1
    }
  }
  return result
}
