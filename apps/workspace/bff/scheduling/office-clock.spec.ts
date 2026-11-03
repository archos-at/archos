/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isFristReminderHour } from './office-clock'

/** The minute-45 runs of one UTC day that pass the gate. */
const passingRunsOn = (day: string): string[] =>
  Array.from({ length: 24 }, (_, hour) => new Date(`${day}T${String(hour).padStart(2, '0')}:45:00Z`))
    .filter(isFristReminderHour)
    .map((date) => date.toISOString())

describe('the Frist reminder runs at 06:45 in Vienna, whatever the UTC offset', () => {
  it('passes 05:45 UTC in winter (CET, UTC+1)', () => {
    expect(passingRunsOn('2026-01-15')).toEqual(['2026-01-15T05:45:00.000Z'])
  })

  it('passes 04:45 UTC in summer (CEST, UTC+2)', () => {
    expect(passingRunsOn('2026-07-15')).toEqual(['2026-07-15T04:45:00.000Z'])
  })

  it('passes exactly once on the day the clocks go forward (2026-03-29)', () => {
    expect(passingRunsOn('2026-03-29')).toEqual(['2026-03-29T04:45:00.000Z'])
  })

  it('passes exactly once on the day the clocks go back (2026-10-25)', () => {
    expect(passingRunsOn('2026-10-25')).toEqual(['2026-10-25T05:45:00.000Z'])
  })
})
