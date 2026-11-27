/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { AgentPrincipal } from './principal'


import { AGENT_KIND } from '@/lib/agent-kind'
import { ownShelfReadable } from './own-shelf'

const session = { organizationId: 'org_1', userId: 'user_me' } as AgentPrincipal['session']
const decision = (over: Record<string, unknown> = {}) =>
  ({ kind: 'chat', organizationId: 'org_1', userId: 'user_me', conversationId: 's_c', may: { personalShelf: true }, ...over }) as never
const principal = (over: Partial<AgentPrincipal>): AgentPrincipal =>
  ({ actor: AGENT_KIND, session, clientId: null, scopes: [], conversationId: 's_c', ...over }) as AgentPrincipal

describe('ownShelfReadable', () => {
  it('lets the in-product agent read the owner’s shelf chats only in a turn whose decision draws on the shelf', () => {
    expect(ownShelfReadable({ principal: principal({ decision: decision() }) })).toBe(true)
    expect(ownShelfReadable({ principal: principal({ decision: decision({ may: { personalShelf: false } }) }) })).toBe(false)
    expect(ownShelfReadable({ principal: principal({}) })).toBe(false)
  })

  it('does not take a decision signed for another chat, person or kind', () => {
    expect(ownShelfReadable({ principal: principal({ decision: decision({ conversationId: 's_other' }) }) })).toBe(false)
    expect(ownShelfReadable({ principal: principal({ decision: decision({ userId: 'user_ina' }) }) })).toBe(false)
    expect(ownShelfReadable({ principal: principal({ decision: decision({ kind: 'run' }) }) })).toBe(false)
  })

  it('lets the person’s own connected agent read them, and no other door', () => {
    expect(ownShelfReadable({ principal: principal({ actor: 'external_agent', clientId: 'c' }) })).toBe(true)
    expect(ownShelfReadable({ principal: principal({ actor: 'external_agent' }), door: 'a2a' })).toBe(false)
    expect(ownShelfReadable({ principal: principal({ door: 'platform' } as Partial<AgentPrincipal>) })).toBe(false)
  })
})
