import { describe, expect, it } from 'vitest'
import { PHONE_LANDSCAPE_QUERY, PHONE_QUERY, resolveStageLayout } from './use-stage-layout'

describe('resolveStageLayout', () => {
  it.each([
    [false, false, 'desktop'],
    [true, false, 'phone'],
    [false, true, 'phone-landscape'],
    [true, true, 'phone-landscape'],
  ] as const)('phone=%s landscape=%s -> %s', (phone, landscape, expected) => {
    expect(resolveStageLayout(phone, landscape)).toBe(expected)
  })

  it('asks "is this a finger on a short landscape screen", not "how wide is it"', () => {
    expect(PHONE_LANDSCAPE_QUERY).toContain('(pointer: coarse)')
    expect(PHONE_LANDSCAPE_QUERY).toContain('(orientation: landscape)')
    expect(PHONE_LANDSCAPE_QUERY).toMatch(/max-height/)
    expect(PHONE_QUERY).toBe('(max-width: 639px)')
  })
})
