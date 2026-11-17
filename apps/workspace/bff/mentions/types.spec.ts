import { describe, expect, it } from 'vitest'
import { LEGACY_AGENT_MENTION_ID } from './legacy-mention-ids'
import { AGENT_MENTION_ID, isAgentMentionId } from './types'

describe('the agent mention id', () => {
  it('is agent:core, and the legacy id still reads as the agent', () => {
    expect(AGENT_MENTION_ID).toBe('agent:core')
    expect(isAgentMentionId(AGENT_MENTION_ID)).toBe(true)
    expect(isAgentMentionId(LEGACY_AGENT_MENTION_ID)).toBe(true)
  })

  it('is no person and no other agent', () => {
    expect(isAgentMentionId('user_anna')).toBe(false)
    expect(isAgentMentionId('agent:other')).toBe(false)
  })
})
