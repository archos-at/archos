/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import * as agentHost from '@/lib/agent-host-contract.generated'
import { CHAT_TURN_DEADLINE_SECONDS, DEFAULT_ASK_MAX_SECONDS } from './ask-wire'

describe('the longest an ask stays open', () => {
  it('is the chat turn deadline the socket enforces', () => {
    expect(CHAT_TURN_DEADLINE_SECONDS).toBe(agentHost.CHAT_TURN_DEADLINE_SECONDS)
  })

  it('outlasts that deadline by a grace for the outcome notice, and no more than a few minutes', () => {
    expect(DEFAULT_ASK_MAX_SECONDS).toBeGreaterThan(CHAT_TURN_DEADLINE_SECONDS)
    expect(DEFAULT_ASK_MAX_SECONDS - CHAT_TURN_DEADLINE_SECONDS).toBeLessThanOrEqual(300)
  })
})
