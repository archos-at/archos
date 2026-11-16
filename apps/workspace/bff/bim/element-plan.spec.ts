/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { PLAN_ROW_BUDGET, shouldWalkOrdered } = await import('./repository')

const decide = (over: Partial<Parameters<typeof shouldWalkOrdered>[0]>): boolean =>
  shouldWalkOrdered({
    matched: 0,
    candidates: null,
    rowsNeeded: 25,
    elementCount: 200_000,
    ...over,
  })

describe('choosing an element-page plan', () => {
  it('keeps the pre-filter when there is no pre-filter to weigh', () => {
    expect(decide({ candidates: null, matched: 100_000 })).toBe(false)
  })

  it('keeps the pre-filter when it is narrow enough to be cheap on its own', () => {
    expect(decide({ candidates: PLAN_ROW_BUDGET, matched: 1 })).toBe(false)
    expect(decide({ candidates: 1, matched: 1 })).toBe(false)
  })

  it('walks when the pre-filter admits everything and matches are dense', () => {
    expect(decide({ candidates: PLAN_ROW_BUDGET + 1, matched: 50_000 })).toBe(true)
  })

  it('refuses to walk when the candidates are broad but the matches are not', () => {
    expect(decide({ candidates: PLAN_ROW_BUDGET + 1, matched: 0 })).toBe(false)
    expect(decide({ candidates: 100_000, matched: 10 })).toBe(false)
  })

  it('accounts for the offset, not just the page size', () => {
    const matched = 10_000
    expect(decide({ candidates: 100_000, matched, rowsNeeded: 25 })).toBe(true)
    expect(decide({ candidates: 100_000, matched, rowsNeeded: 25 + 1_000 })).toBe(false)
  })

  it('scales with the model, not with a fixed row count', () => {
    expect(decide({ candidates: 5_000, matched: 100, elementCount: 200_000 })).toBe(false)
    expect(decide({ candidates: 5_000, matched: 100, elementCount: 5_000 })).toBe(true)
  })
})
