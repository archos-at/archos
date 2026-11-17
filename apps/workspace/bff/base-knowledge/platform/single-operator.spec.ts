/**
 * @vitest-environment node
 *
 * The switch is off unless the deployment says exactly `true`: prod sets
 * nothing, and anything else keeps four eyes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { singleOperator } = await import('./single-operator')

describe('singleOperator', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is off by default', () => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', undefined)
    expect(singleOperator()).toBe(false)
  })

  it.each(['', 'false', '1', 'yes', 'on'])('is off for %j', (value) => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', value)
    expect(singleOperator()).toBe(false)
  })

  it.each(['true', 'TRUE', ' true '])('is on for %j', (value) => {
    vi.stubEnv('KNOWLEDGE_SINGLE_OPERATOR', value)
    expect(singleOperator()).toBe(true)
  })
})
