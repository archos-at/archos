// @disk-inputs: ../agent-host/src/agent_host/chat_turn.py
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHAT_TURN_DEADLINE_SECONDS, DEFAULT_ASK_MAX_SECONDS } from './ask-wire'

const CHAT_TURN = join(__dirname, '..', '..', '..', '..', 'apps', 'agent-host', 'src', 'agent_host', 'chat_turn.py')

describe('the longest an ask stays open', () => {
  it('is the chat turn deadline the socket enforces', () => {
    const source = readFileSync(CHAT_TURN, 'utf8')
    const match = /CHAT_TURN_DEADLINE_SECONDS", "(\d+)"/.exec(source)
    expect(match, 'CHAT_TURN_DEADLINE_SECONDS default not found in chat_turn.py').not.toBeNull()
    expect(CHAT_TURN_DEADLINE_SECONDS).toBe(Number(match![1]))
  })

  it('outlasts that deadline by a grace for the outcome notice, and no more than a few minutes', () => {
    expect(DEFAULT_ASK_MAX_SECONDS).toBeGreaterThan(CHAT_TURN_DEADLINE_SECONDS)
    expect(DEFAULT_ASK_MAX_SECONDS - CHAT_TURN_DEADLINE_SECONDS).toBeLessThanOrEqual(300)
  })
})
