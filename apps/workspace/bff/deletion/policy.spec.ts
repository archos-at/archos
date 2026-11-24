/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { computePurgeAfter, projectGraceDays } from './policy'

describe('projectGraceDays', () => {
  it('defaults to 7 when env is unset', () => {
    vi.stubEnv('PROJECT_PURGE_GRACE_DAYS', undefined)
    expect(projectGraceDays()).toBe(7)
  })

  it('reads the env override', () => {
    vi.stubEnv('PROJECT_PURGE_GRACE_DAYS', '0')
    expect(projectGraceDays()).toBe(0)
  })

  it('caps at 23 days to stay inside the GDPR one-month window', () => {
    vi.stubEnv('PROJECT_PURGE_GRACE_DAYS', '90')
    expect(projectGraceDays()).toBe(23)
  })

  it('falls back to 7 on garbage input', () => {
    vi.stubEnv('PROJECT_PURGE_GRACE_DAYS', 'soon')
    expect(projectGraceDays()).toBe(7)
  })
})

describe('computePurgeAfter', () => {
  it('adds whole days to the request time', () => {
    const now = new Date('2026-07-05T12:00:00Z')
    expect(computePurgeAfter(now, 7).toISOString()).toBe('2026-07-12T12:00:00.000Z')
  })

  it('returns the request time itself for zero grace', () => {
    const now = new Date('2026-07-05T12:00:00Z')
    expect(computePurgeAfter(now, 0).getTime()).toBe(now.getTime())
  })
})
