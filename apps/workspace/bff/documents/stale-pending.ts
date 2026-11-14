/**
 * The sweep that reads back ingests nobody is waiting on.
 *
 * The backend writes no result into Postgres: a row leaves `pending` when the
 * reconcile asks the backend (`reconcile-status.ts`). It asks on a read, which
 * comes from an open tab; on the worker's settle push (`settle-push.ts`), which
 * is best effort; and for the 25 newest open upload batches of the last week,
 * on the upload sweep. Before the push existed, a document outside the other
 * two (filed through a folder or sync, a batch older than the window or behind
 * 25 newer open ones, an office that went home) stayed `pending` until somebody
 * next opened its shelf: 6 hours in one office on 2026-11-02, days in another
 * on 2026-10-28; a lost push leaves one there still. This is the clock behind
 * them, run
 * every minute by the `reconcile-background-work` Hatchet task (`bff/scheduling/sweeps.ts`).
 *
 * Safe from several replicas at once: a status write is guarded by the status it
 * read, and a settled row is never selected again.
 */

import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { reconcileDocumentStatuses } from './reconcile-status'
import { listStalePendingDocuments } from './repository'

/** A dispatch must be this old before the sweep asks: an open tab's own polling comes first. */
export const STALE_PENDING_AFTER_MINUTES = 5
/** Rows one sweep reads back. Bounded: it is housekeeping on a one-minute cron. */
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
