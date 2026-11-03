/**
 * What `fire-task-definition` does when a definition's scheduled run fires
 * (ADR-0150), and the repair sweep that backs it up.
 *
 * A fire takes the occurrence first (`advanceDueDefinition`: the row must still
 * be due at the input's `due_at`, and `next_run_at` moves on in the same
 * transaction), schedules the next run, and only then starts the work through
 * `fireScheduledJob`, the gate the BFF fire endpoint used to call. That order
 * is the old scheduler's at-most-once: a crash after the advance misses one
 * occurrence rather than spending somebody's budget twice.
 *
 * Missed fires coalesce as before. The next due time is computed from now, not
 * from the missed one, so a definition that was due during an outage fires
 * once when it is reached and then jumps to its next future slot.
 */

import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { fireScheduledJob } from '@/lib/jobs/service'
import { nextDue } from './next-due'
import { report } from './log'
import { advanceDueDefinition, findDefinitionsToRepair } from './repository'
import { syncScheduledRun, type FireTaskDefinitionInput } from './scheduled-runs'

export type FireDefinitionOutcome = Awaited<ReturnType<typeof fireScheduledJob>> | { fired: false; reason: 'not-due' | 'invalid' }

/** Fire one occurrence. A duplicate or stale fire answers `not-due` and records nothing. */
export function fireTaskDefinition(input: FireTaskDefinitionInput, now: Date = new Date()): Promise<FireDefinitionOutcome> {
  return withTenant({ organizationId: input.organization_id }, async () => {
    const taken = await advanceDueDefinition(input.definition_id, input.organization_id, new Date(input.due_at), (row) =>
      nextDue(row, now),
    )
    if (!taken) return { fired: false, reason: 'not-due' }
    await syncScheduledRun(taken.definition, now)
    if (!taken.fire) return { fired: false, reason: 'invalid' }
    return fireScheduledJob(taken.definition)
  })
}

/** How long past its due time a definition may go unfired before the repair steps in. */
export const REPAIR_GRACE_MINUTES = 3
/**
 * Definitions one repair schedules. A cutover leaves every enabled definition
 * without a scheduled run (0192 has no backfill), so one or two repairs must
 * cover an installation's schedules; each is one Hatchet call, well inside the
 * sweep's 10-minute timeout.
 */
export const REPAIR_BATCH = 500

/**
 * Give every enabled definition with a due time the scheduled run it lacks:
 * one that is overdue (a Hatchet call that failed at save time, a fire that
 * timed out in Hatchet's queue while no worker was up) gets a run due now, and
 * one with no scheduled run at all (every definition from before the cutover)
 * gets its run at its due time, however far ahead that is, so it fires on
 * time instead of a repair late. Idempotent: a definition it gave a run, and
 * that is not overdue, is not found again. Returns how many.
 */
export async function repairSchedules(now: Date = new Date()): Promise<number> {
  const missing = await findDefinitionsToRepair(REPAIR_GRACE_MINUTES, REPAIR_BATCH)
  for (const definition of missing) {
    await withTenant({ organizationId: definition.organizationId }, () => syncScheduledRun(definition, now))
  }
  if (missing.length > 0) report(`schedule repair: scheduled ${missing.length} definition(s) that were overdue or had no scheduled run`)
  return missing.length
}
