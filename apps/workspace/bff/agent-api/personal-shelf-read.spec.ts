/**
 * @vitest-environment node
 *
 * The in-product agent reaches its asker's own shelf only through the turn's
 * decision (ADR-0193, ADR-0194): the read gate admits the read live, records it,
 * and only then lets the turn's pinned session through the shelf's door.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: vi.fn((_tenant: unknown, run: () => unknown) => run()) }))
vi.mock('@/lib/conversations/personal-shelf-use', () => ({ admitPersonalShelf: vi.fn() }))
vi.mock('./conversation-audience', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./conversation-audience')>()),
  conversationAudienceOf: vi.fn(async () => ({ workspaceRead: 'all' })),
  judgeWorkspaceRead: vi.fn(),
  recordWorkspaceHandOut: vi.fn(async () => true),
}))

import { admitPersonalShelf } from '@/lib/conversations/personal-shelf-use'
import { mayReachPersonalShelf } from '@/lib/documents/personal-shelf-door'
import { READ_REFUSALS, judgeWorkspaceRead } from './conversation-audience'
import type { AgentPrincipal } from './principal'
import { readGateFor } from './read-gate'

const decision = { conversationId: 's_c' } as never
const principalOf = (): AgentPrincipal =>
  ({
    session: { organizationId: 'org_1', userId: 'user_me', pinnedForTurn: true } as AuthorizedSession,
    conversationId: 's_c',
    projectId: null,
    answerMessageId: 'a0000000-0000-4000-8000-000000000001',
    decision,
  }) as unknown as AgentPrincipal
const LIST = { name: 'document-list', domain: 'documents' } as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(judgeWorkspaceRead).mockResolvedValue({ handOut: { projectIds: [], folderIds: [] }, personalShelf: true })
})

describe('a read of the asker’s own shelf by the in-product agent', () => {
  it('is admitted under the turn’s decision and recorded, and only then opens the shelf’s door', async () => {
    const principal = principalOf()
    vi.mocked(admitPersonalShelf).mockResolvedValueOnce(['personal_org_1__user_me'])
    expect(mayReachPersonalShelf(principal.session)).toBe(false)

    expect(await readGateFor(principal).beforeRead(LIST, { query: { scope: 'personal' } })).toBeNull()

    expect(admitPersonalShelf).toHaveBeenCalledWith(
      { organizationId: 'org_1', conversationId: 's_c', userId: 'user_me', answerMessageId: 'a0000000-0000-4000-8000-000000000001' },
      ['personal_org_1__user_me'],
      decision,
    )
    expect(mayReachPersonalShelf(principal.session)).toBe(true)
  })

  it('is refused, and the door stays shut, when the admission refuses it', async () => {
    const principal = principalOf()
    vi.mocked(admitPersonalShelf).mockResolvedValueOnce([])

    expect(await readGateFor(principal).beforeRead(LIST, { query: { scope: 'personal' } })).toBe(READ_REFUSALS.personalShelf)
    expect(mayReachPersonalShelf(principal.session)).toBe(false)
  })

  it('asks nothing for a read that does not reach the shelf', async () => {
    vi.mocked(judgeWorkspaceRead).mockResolvedValueOnce({ handOut: { projectIds: [], folderIds: [] }, personalShelf: false })

    expect(await readGateFor(principalOf()).beforeRead(LIST, {})).toBeNull()
    expect(admitPersonalShelf).not.toHaveBeenCalled()
  })
})
