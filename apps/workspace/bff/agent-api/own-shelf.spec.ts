/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { AgentPrincipal } from './principal'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/conversations/personal-shelf-use', () => ({
  decisionAllowsPersonalShelf: vi.fn((decision: { may?: { personalShelf?: boolean } } | null) => decision?.may?.personalShelf === true),
}))

import { AGENT_KIND } from '@/lib/agent-kind'
import { ownShelfReadable } from './own-shelf'

const session = { organizationId: 'org_1', userId: 'user_me' } as AgentPrincipal['session']
const principal = (over: Partial<AgentPrincipal>): AgentPrincipal =>
  ({ actor: AGENT_KIND, session, clientId: null, scopes: [], conversationId: 's_c', ...over }) as AgentPrincipal

describe('ownShelfReadable', () => {
  it('lets the in-product agent read the owner’s shelf chats only in a turn whose decision draws on the shelf', () => {
    expect(ownShelfReadable({ principal: principal({ decision: { may: { personalShelf: true } } as never }) })).toBe(true)
    expect(ownShelfReadable({ principal: principal({ decision: { may: { personalShelf: false } } as never }) })).toBe(false)
    expect(ownShelfReadable({ principal: principal({}) })).toBe(false)
  })

  it('lets the person’s own connected agent read them, and no other door', () => {
    expect(ownShelfReadable({ principal: principal({ actor: 'external_agent', clientId: 'c' }) })).toBe(true)
    expect(ownShelfReadable({ principal: principal({ actor: 'external_agent' }), door: 'a2a' })).toBe(false)
    expect(ownShelfReadable({ principal: principal({ door: 'platform' } as Partial<AgentPrincipal>) })).toBe(false)
  })
})
