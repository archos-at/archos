/**
 * One Hatchet scheduled run per due definition (ADR-0150).
 *
 * The next due time is ours: `bff/jobs/schedule.ts` computes it in the office's
 * time zone and it is stored in `next_run_at`. Hatchet's crons take no time zone
 * and would drift by an hour at every daylight-saving change, so a recurring
 * definition is not a Hatchet cron. Instead, each enabled definition with a
 * `next_run_at` has exactly one scheduled run of `fire-task-definition` at that
 * time, and every write that moves `next_run_at` (create, edit, pause, delete,
 * a fire, a re-arm) replaces it through {@link syncScheduledRun}.
 *
 * A Hatchet call that fails is logged, never thrown: the definition was saved,
 * and the repair sweep (`./fire-definition.ts`, `repairOverdueSchedules`) gives
 * any row that passes its due time without a fire a new scheduled run.
 */

import 'server-only'
import type { TaskDefinition } from '@/lib/db/schema/task-model'
import * as tasks from '@/lib/tasks/repository'
import { schedulingHatchet } from './hatchet'
import { setScheduledRunId } from './repository'

export const FIRE_TASK_DEFINITION = 'fire-task-definition'

/**
 * The input of `fire-task-definition`: ids and the due time, nothing an office
 * wrote (ADR-0150). Snake case, because the concurrency key is the CEL
 * expression `input.organization_id` on every tier.
 */
export interface FireTaskDefinitionInput {
  definition_id: string
  organization_id: string
  due_at: string
  [key: string]: string
}

type ScheduledDefinition = Pick<TaskDefinition, 'id' | 'organizationId' | 'enabled' | 'nextRunAt' | 'scheduledRunId'>

const LOG = '[scheduling]'

/** Delete a scheduled run; one that already fired or is gone is not an error worth more than a line. */
async function deleteScheduledRun(scheduledRunId: string): Promise<void> {
  try {
    await (await schedulingHatchet()).scheduled.delete(scheduledRunId)
  } catch (error) {
    // A leftover run is harmless: its fire finds `next_run_at` moved and records nothing.
    console.warn(`${LOG} could not delete scheduled run ${scheduledRunId}:`, error instanceof Error ? error.message : error)
  }
}

/**
 * Make Hatchet hold exactly the run this definition needs: none when it is
 * paused or has no due time, otherwise one at `next_run_at` (now, when that is
 * already past). The previous run, if any, is deleted first. Never throws.
 */
export async function syncScheduledRun(definition: ScheduledDefinition, now: Date = new Date()): Promise<void> {
  if (definition.scheduledRunId) await deleteScheduledRun(definition.scheduledRunId)
  const due = definition.enabled ? definition.nextRunAt : null
  let scheduledRunId: string | null = null
  try {
    if (due) {
      const input: FireTaskDefinitionInput = {
        definition_id: definition.id,
        organization_id: definition.organizationId,
        due_at: due.toISOString(),
      }
      const hatchet = await schedulingHatchet()
      const created = await hatchet.scheduled.create(FIRE_TASK_DEFINITION, {
        triggerAt: new Date(Math.max(due.getTime(), now.getTime())),
        input,
        additionalMetadata: { definition_id: definition.id },
      })
      scheduledRunId = created.metadata.id
    }
    if (scheduledRunId !== definition.scheduledRunId) {
      await setScheduledRunId(definition.id, definition.organizationId, scheduledRunId)
    }
  } catch (error) {
    console.error(`${LOG} could not schedule definition ${definition.id}; the repair sweep will:`, error)
  }
}

/** The definition is gone: delete the run that would have fired it. */
export async function dropScheduledRun(definition: Pick<TaskDefinition, 'scheduledRunId'>): Promise<void> {
  if (definition.scheduledRunId) await deleteScheduledRun(definition.scheduledRunId)
}

/**
 * Re-arm the dated one-shots a pause or close retired (ADR-0098,
 * `rearmOneShotsSkippedWhileParked`), and give each its scheduled run, due now.
 * Returns how many came back.
 */
export async function rearmOneShotsSkippedWhileParked(projectId: string, organizationId: string): Promise<number> {
  const rearmed = await tasks.rearmOneShotsSkippedWhileParked(projectId, organizationId)
  for (const definition of rearmed) await syncScheduledRun(definition)
  return rearmed.length
}
