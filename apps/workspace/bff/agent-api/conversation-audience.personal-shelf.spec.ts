/**
 * @vitest-environment node
 *
 * Reading another chat that read its owner's shelf (ADR-0193): only a turn
 * that may itself draw on that same person's shelf reads it, and the read is
 * then admitted like a shelf read; every other read is refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: vi.fn((_tenant: unknown, run: () => unknown) => run()) }))
vi.mock('@/lib/conversations/restricted-use-repository', () => ({ readConversationAudience: vi.fn() }))
vi.mock('@/lib/conversations/cross-project-use', () => ({ drewOnOtherProjects: vi.fn(async () => false) }))
vi.mock('@/lib/cross-project/audience-reach', () => ({ audienceReachAmong: vi.fn() }))
vi.mock('@/lib/authz/folder-access-repository', () => ({ listProjectFolderTree: vi.fn() }))
vi.mock('@/lib/authz/folder-access', () => ({}))
vi.mock('./operation-targets', async (original) => ({
  ...(await original<typeof import('./operation-targets')>()),
  placesOf: vi.fn(async () => [{ projectId: null, conversationId: 's_other' }]),
}))
vi.mock('@/lib/conversations/personal-shelf-use', async (original) => ({
  ...(await original<typeof import('@/lib/conversations/personal-shelf-use')>()),
  personalShelfUseOf: vi.fn(async () => ({ ownerId: 'user_me' })),
}))

import { personalShelfUseOf } from '@/lib/conversations/personal-shelf-use'
import { READ_REFUSALS, judgeWorkspaceRead, type ConversationAudience } from './conversation-audience'
import type { AgentPrincipal } from './principal'

const allowing = { kind: 'chat', organizationId: 'org_1', userId: 'user_me', conversationId: 's_mine', may: { personalShelf: true } }
const principalOf = (userId: string, decision: unknown): AgentPrincipal =>
  ({ session: { organizationId: 'org_1', userId }, conversationId: 's_mine', projectId: null, decision }) as unknown as AgentPrincipal
const audience = { workspaceRead: 'all', solo: true } as ConversationAudience
const READ_OTHER = { path: '/api/conversations/[id]/messages' as const }
const judge = (principal: AgentPrincipal) =>
  judgeWorkspaceRead(principal, audience, READ_OTHER as never, { params: { id: 's_other' } }, undefined, async () => [])

beforeEach(() => vi.clearAllMocks())

describe('reading a chat that read Meine Ablage', () => {
  it('is a shelf read for its owner in a turn that may draw on the shelf, admitted by the gate', async () => {
    expect(await judge(principalOf('user_me', allowing))).toMatchObject({ personalShelf: true })
  })

  it('is refused for anyone else, and for the owner in a turn that may not draw on the shelf', async () => {
    expect(await judge(principalOf('user_ina', { ...allowing, userId: 'user_ina' }))).toEqual({ refusal: READ_REFUSALS.personalShelf })
    expect(await judge(principalOf('user_me', { ...allowing, may: { personalShelf: false } }))).toEqual({
      refusal: READ_REFUSALS.personalShelf,
    })
    expect(await judge(principalOf('user_me', null))).toEqual({ refusal: READ_REFUSALS.personalShelf })
  })

  it('is an ordinary read of a chat that never used the shelf', async () => {
    vi.mocked(personalShelfUseOf).mockResolvedValueOnce(null)
    expect(await judge(principalOf('user_ina', null))).toMatchObject({ personalShelf: false })
  })
})
