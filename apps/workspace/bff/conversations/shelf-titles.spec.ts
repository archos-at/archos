/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/tenant-context', () => ({ withTenant: vi.fn((_t: unknown, run: () => unknown) => run()) }))
const rows = vi.hoisted(() => ({ value: [] as unknown[] }))
vi.mock('@/lib/db', () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: async () => rows.value }) }) }) }))

import { runAsActingSession } from '@/lib/agent-api/acting-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { hidesShelfChatFromAgent, shelfChatsHiddenFromAgent } from './shelf-titles'

const session = { organizationId: 'org_1', userId: 'user_me' } as AuthorizedSession
const used = new Date('2026-11-01T00:00:00Z')
const mine = { id: 's_mine', createdBy: 'user_me', personalShelfUsedAt: used }
const hers = { id: 's_hers', createdBy: 'user_ina', personalShelfUsedAt: used }
const plain = { createdBy: 'user_me', personalShelfUsedAt: null }

describe('hidesShelfChatFromAgent', () => {
  it('hides nothing from a person', () => {
    expect(hidesShelfChatFromAgent(mine, 'user_me')).toBe(false)
    expect(hidesShelfChatFromAgent(hers, 'user_me')).toBe(false)
  })

  it('hides a shelf chat from an agent, except the caller’s own when the call may read their shelf', async () => {
    await runAsActingSession(session, async () => {
      expect(hidesShelfChatFromAgent(mine, 'user_me')).toBe(true)
      expect(hidesShelfChatFromAgent(plain, 'user_me')).toBe(false)
    }, 'agent')
    await runAsActingSession(session, async () => {
      expect(hidesShelfChatFromAgent(mine, 'user_me')).toBe(false)
      expect(hidesShelfChatFromAgent(hers, 'user_me')).toBe(true)
    }, 'agent', { ownShelfReadable: true })
  })
})

describe('shelfChatsHiddenFromAgent', () => {
  it('reads nothing for a person, and names the hidden ones for an agent', async () => {
    rows.value = [mine, hers]
    expect(await shelfChatsHiddenFromAgent('org_1', 'user_me', ['s_mine', 's_hers'])).toEqual(new Set())
    const forAgent = await runAsActingSession(session, () => shelfChatsHiddenFromAgent('org_1', 'user_me', ['s_mine', 's_hers']), 'agent', {
      ownShelfReadable: true,
    })
    expect(forAgent).toEqual(new Set(['s_hers']))
  })
})
