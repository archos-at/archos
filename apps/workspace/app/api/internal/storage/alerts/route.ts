/**
 * Internal storage-alert sweep (ADR-0042).
 *
 * Token-guarded (`internalApiRoute`), not session-authenticated: this is
 * housekeeping invoked by a clock, not by a person. The caller is the
 * `storage-alerts` CronJob in `deploy/pulumi/src/app/workers.ts`, which predates
 * the Hatchet cron sweeps (`bff/scheduling/tasks.ts`, ADR-0150), where a new
 * sweep belongs.
 *
 * Idempotent by construction: the sweep suppresses an alert whose row is already
 * live, so calling it more often than needed changes nothing except the log.
 * That is what makes a CronJob (at-least-once, no coordination) a safe caller.
 */

import { internalApiRoute } from '@/lib/api/handler'
import { runStorageAlertSweep } from '@/lib/storage/alerts'

export const POST = internalApiRoute(
  'StorageAlerts',
  // The counts come back in the response body rather than a log line: the
  // caller is a CronJob whose pod log already
  // captures the response, and a per-tick line for routine housekeeping is noise.
  // The two conditions an operator must act on — a tenant with no admin to tell,
  // and a failed per-org evaluation — are logged by the sweep itself.
  () => runStorageAlertSweep(),
  {
    tenancy: {
      crossTenant:
        'discovery only: one grouped aggregate of stored bytes across every organization. ' +
        'The sweep then re-enters each organization with withTenant, so the per-org quota ' +
        'read and the inbox writes are still subject to row-level security',
    },
  },
)
