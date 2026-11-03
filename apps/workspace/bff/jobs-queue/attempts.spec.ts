/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isLastAttempt, maxAttempts } from './attempts'

describe('maxAttempts', () => {
  it('reads the pod’s knob', () => {
    expect(maxAttempts({ BFF_JOBS_MAX_ATTEMPTS: '5' })).toBe(5)
  })

  it.each(['', '0', '-2', 'many'])('falls back to the default for %j', (raw) => {
    expect(maxAttempts({ BFF_JOBS_MAX_ATTEMPTS: raw })).toBe(3)
  })

  it('names the last attempt, and only that one', () => {
    expect(isLastAttempt(2, {})).toBe(false)
    expect(isLastAttempt(3, {})).toBe(true)
    expect(isLastAttempt(1, { BFF_JOBS_MAX_ATTEMPTS: '1' })).toBe(true)
  })
})
