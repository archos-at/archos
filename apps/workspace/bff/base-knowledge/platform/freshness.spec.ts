/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PLATFORM_FRESHNESS_DAYS, platformEditionOverdue } from './freshness'

const NOW = new Date('2026-11-10T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

describe('platform freshness targets', () => {
  it('checks statutes every 14 days, adoptions every 30, standards every 90', () => {
    expect(PLATFORM_FRESHNESS_DAYS).toMatchObject({ statute: 14, guideline: 30, authority_directive: 30, technical_standard: 90 })
  })

  it('is due once the target has passed, and not before', () => {
    expect(platformEditionOverdue('statute', { checkedAt: daysAgo(13), result: 'current' }, NOW)).toBe(false)
    expect(platformEditionOverdue('statute', { checkedAt: daysAgo(14), result: 'current' }, NOW)).toBe(true)
    expect(platformEditionOverdue('technical_standard', { checkedAt: daysAgo(89), result: 'current' }, NOW)).toBe(false)
  })

  it('is overdue when never checked or when the last check found anything but current (fail closed)', () => {
    expect(platformEditionOverdue('commentary', null, NOW)).toBe(true)
    expect(platformEditionOverdue('commentary', { checkedAt: daysAgo(1), result: 'newer_known' }, NOW)).toBe(true)
  })
})
