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
 * Replaced, not rescheduled. The SDK's `scheduled.update` moves a pending run's
 * `triggerAt` and nothing else (tried on engine v0.114.2, 2026-11-11): the run
 * keeps its input, so it would fire with the old `due_at`, which the fire
 * compares with `next_run_at` and answers `not-due`. And the commonest caller,
 * a fire, holds the id of the run that just fired, which the engine no longer
 * has (404 on get, update and delete alike).
 *
 * A Hatchet call that fails is logged, never thrown: the definition was saved,
 * and the repair sweep (`./fire-definition.ts`, `repairSchedules`) gives
 * any row that passes its due time without a fire, or has none, a scheduled run.
 */

import 'server-only'
import type { TaskDefinition } from '@/lib/db/schema/task-model'
import * as tasks from '@/lib/tasks/repository'
import { hatchetClient } from '@/lib/jobs-queue/orchestrator'
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

/** The engine's answer for a scheduled run it no longer has: one that fired, or was deleted. */
const isNotFound = (error: unknown): boolean => (error as { response?: { status?: number } } | null)?.response?.status === 404

/** Delete a scheduled run. One that is already gone is what was asked for; any other failure is a line, never a throw. */
async function deleteScheduledRun(scheduledRunId: string): Promise<void> {
  try {
    await hatchetClient().scheduled.delete(scheduledRunId)
  } catch (error) {
    // Every fire lands here: it re-arms the definition holding the id of the run that just fired.
    if (isNotFound(error)) return
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
      const created = await hatchetClient().scheduled.create(FIRE_TASK_DEFINITION, {
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
