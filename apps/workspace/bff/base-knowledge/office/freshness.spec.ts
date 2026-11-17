import { describe, expect, it } from 'vitest'
import { freshnessOf } from './freshness'

const NOW = new Date('2026-11-06T12:00:00Z')
const check = (checkedAt: string, result: 'current' | 'newer_known' = 'current') => ({
  checkedAt,
  checkedBy: 'user_1',
  result,
  note: null,
})

describe('how fresh an entry’s last check is', () => {
  it('holds a standard for a year and a directive for half of one', () => {
    expect(freshnessOf('technical_standard', check('2026-01-10T00:00:00Z'), NOW).overdue).toBe(false)
    expect(freshnessOf('authority_directive', check('2026-01-10T00:00:00Z'), NOW)).toMatchObject({
      intervalDays: 180,
      overdue: true,
    })
  })

  it('is overdue when never checked, or when the check found a newer edition', () => {
    expect(freshnessOf('technical_standard', null, NOW)).toMatchObject({ overdue: true, dueAt: null })
    expect(freshnessOf('technical_standard', check('2026-11-01T00:00:00Z', 'newer_known'), NOW).overdue).toBe(true)
  })

  it('names when the next check is due', () => {
    expect(freshnessOf('commentary', check('2026-01-01T00:00:00Z'), NOW).dueAt).toBe('2027-01-01T00:00:00.000Z')
  })
})
