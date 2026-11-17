import { nextOccurrence } from '@/lib/jobs/schedule'
import type { TaskDefinition } from '@/lib/db/schema/task-model'
import type { DueAdvance } from './repository'

const LOG = '[scheduling]'

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
