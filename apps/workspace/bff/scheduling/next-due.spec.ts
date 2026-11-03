/**
 * @vitest-environment node
 *
 * Where a definition goes after a fire (`nextDue`): plain logic, no Hatchet and
 * no database.
 */
import { describe, expect, it, vi } from 'vitest'
import type { TaskDefinition } from '@/lib/db/schema/task-model'
import { nextDue } from './next-due'

const definition = (patch: Partial<TaskDefinition>): TaskDefinition =>
  ({
    id: 'def_1',
    trigger: 'schedule',
    enabled: true,
    scheduleCron: '0 9 * * 1',
    scheduleTimezone: 'Europe/Vienna',
    ...patch,
  }) as TaskDefinition

describe('nextDue', () => {
  it('moves a schedule to its next occurrence after now, in its own time zone', () => {
    const now = new Date('2026-03-23T10:00:00Z') // a Monday, after 09:00 Vienna (CET)

    // The next Monday is after the clocks went forward: 09:00 CEST is 07:00 UTC.
    expect(nextDue(definition({}), now)).toEqual({ nextRunAt: new Date('2026-03-30T07:00:00Z'), enabled: true, fire: true })
  })

  it('fires once and jumps to the next future slot after an outage, never backfilling', () => {
    const afterOutage = new Date('2026-04-21T12:00:00Z') // three Mondays were missed

    expect(nextDue(definition({}), afterOutage).nextRunAt).toEqual(new Date('2026-04-27T07:00:00Z'))
  })

  it('retires a one-shot and leaves its pause switch alone', () => {
    expect(nextDue(definition({ trigger: 'once', scheduleCron: null }), new Date())).toEqual({ nextRunAt: null, enabled: true, fire: true })
  })

  it('disables, without firing, a schedule whose cron no longer parses', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(nextDue(definition({ scheduleCron: 'every monday' }), new Date())).toEqual({ nextRunAt: null, enabled: false, fire: false })
  })

  it('clears, without firing, a manual definition that holds a due time', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(nextDue(definition({ trigger: 'manual', scheduleCron: null }), new Date())).toEqual({ nextRunAt: null, enabled: true, fire: false })
  })
})
