/**
 * The next-run computation of a fire, apart from everything that touches the
 * database or Hatchet, so it is tested as plain logic.
 */

import { nextOccurrence } from '@/lib/jobs/schedule'
import type { TaskDefinition } from '@/lib/db/schema/task-model'
import type { DueAdvance } from './repository'

const LOG = '[scheduling]'

/**
 * Where a definition goes after the occurrence it was due for. Pure.
 *
 *   - a `schedule` moves to its next occurrence strictly after `now`, in its
 *     own time zone; a cron that no longer parses (validated at save time, so
 *     should be impossible) disables the row loudly instead of firing;
 *   - a `once` retires: `next_run_at` NULL, `enabled` untouched, because that is
 *     the person's pause switch and a finished task is not a paused one;
 *   - anything else (a `manual` row holding a due time) is cleared, not fired:
 *     it runs when a person says so.
 */
export function nextDue(definition: TaskDefinition, now: Date): DueAdvance {
  if (definition.trigger === 'once') return { nextRunAt: null, enabled: definition.enabled, fire: true }
  if (definition.trigger !== 'schedule' || !definition.scheduleCron) {
    console.error(`${LOG} definition ${definition.id} is ${JSON.stringify(definition.trigger)} but had a due time; clearing it without firing`)
    return { nextRunAt: null, enabled: definition.enabled, fire: false }
  }
  try {
    return { nextRunAt: nextOccurrence(definition.scheduleCron, definition.scheduleTimezone, now), enabled: true, fire: true }
  } catch (error) {
    console.error(`${LOG} definition ${definition.id} has an unparseable cron; disabling it`, error)
    return { nextRunAt: null, enabled: false, fire: false }
  }
}
