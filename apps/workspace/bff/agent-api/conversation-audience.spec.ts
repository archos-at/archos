/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: vi.fn((_tenant: unknown, run: () => unknown) => run()) }))
vi.mock('@/lib/conversations/restricted-use-repository', () => ({ readConversationAudience: vi.fn() }))
vi.mock('@/lib/conversations/cross-project-use', () => ({}))
vi.mock('@/lib/cross-project/audience-reach', () => ({ audienceReachAmong: vi.fn(async () => ({ projects: [], restrictedFolders: false, version: 4, ownProjectId: 'proj_1' })) }))
vi.mock('@/lib/authz/folder-access-repository', () => ({ listProjectFolderTree: vi.fn() }))
vi.mock('@/lib/authz/folder-access', () => ({}))
vi.mock('./operation-targets', () => ({ placesOf: vi.fn(async () => [{ projectId: 'proj_other', conversationId: null }]) }))

import { readConversationAudience } from '@/lib/conversations/restricted-use-repository'
import { conversationAudienceOf, proposalReachRefusal, READ_REFUSALS } from './conversation-audience'
import { closedContext } from '@/lib/conversation-context/context.fixtures'
import { decisionOf } from '@/lib/conversation-context/wire'
import type { AgentPrincipal } from './principal'

const session = {
  userId: 'user_1',
  email: 'a@example.test',
  name: null,
  accessToken: '',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'admin' as const,
  permissions: [],
  featureFlags: null,
}
const inProduct = (extra: Partial<AgentPrincipal> = {}): AgentPrincipal => ({
  actor: 'piloti',
  session,
  clientId: null,
  scopes: [],
  conversationId: 'conv_1',
  projectId: 'proj_1',
  ...extra,
})
const audience = (extra: object) => ({
  exists: true,
  projectId: 'proj_1',
  createdBy: 'user_1',
  visibility: 'private' as const,
  grantees: [] as string[],
  version: 4 as number | null,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
})

const closed = closedContext('chat', 'conv_1')
const base = decisionOf(closed, { organizationId: 'org_1', userId: 'user_1' }, null, 1)

describe('conversationAudienceOf', () => {
  it('is null for an external agent and for a call in no conversation', async () => {
    expect(await conversationAudienceOf({ actor: 'external_agent', session, clientId: 'c', scopes: [] })).toBeNull()
    expect(await conversationAudienceOf(inProduct({ conversationId: null }))).toBeNull()
    expect(readConversationAudience).not.toHaveBeenCalled()
  })

  it('is solo for a private chat of the requester, and for one not created yet', async () => {
    vi.mocked(readConversationAudience).mockResolvedValueOnce(audience({}))
    expect(await conversationAudienceOf(inProduct())).toMatchObject({ solo: true, version: 4 })
    vi.mocked(readConversationAudience).mockResolvedValueOnce(audience({ exists: false, version: null }))
    expect(await conversationAudienceOf(inProduct())).toMatchObject({ solo: true, version: null })
  })

  it('is shared once anyone else reads it, with the version the record checks under the lock', async () => {
    for (const shared of [{ grantees: ['user_2'] }, { visibility: 'project' }, { createdBy: 'user_2' }]) {
      vi.mocked(readConversationAudience).mockResolvedValueOnce(audience(shared))
      const found = await conversationAudienceOf(inProduct())
      expect(found?.solo, JSON.stringify(shared)).toBe(false)
      expect(found?.version, JSON.stringify(shared)).toBe(4)
    }
  })
})

describe('the turn decision narrows the audience, never widens it (ADR-0194)', () => {
  const decided = (solo: boolean, conversationId = 'conv_1') => ({ conversationId, solo })

  it('reads a chat shared since the turn was decided as shared, and carries today’s version instead of refusing', async () => {
    vi.mocked(readConversationAudience).mockResolvedValueOnce(audience({ grantees: ['user_2'], version: 9 }))
    expect(await conversationAudienceOf(inProduct({ decision: { ...base, ...decided(true) } }))).toMatchObject({
      solo: false,
      version: 9,
    })
  })

  it('keeps a turn decided shared shared, though the grant was revoked since', async () => {
    vi.mocked(readConversationAudience).mockResolvedValueOnce(audience({}))
    expect(await conversationAudienceOf(inProduct({ decision: { ...base, ...decided(false) } }))).toMatchObject({ solo: false })
  })

  it('closes a call whose decision names another conversation', async () => {
    vi.mocked(readConversationAudience).mockResolvedValueOnce(audience({}))
    expect(await conversationAudienceOf(inProduct({ decision: { ...base, ...decided(true, 'conv_other') } }))).toMatchObject({
      solo: false,
    })
  })

  it('narrows a document check in a solo chat to a document or the project’s facts, as its headless decision says', async () => {
    const headless = decisionOf(
      { ...closedContext('headless', 'conv_1'), audience: { ...closed.audience, solo: true }, may: { ...closed.may, workspaceRead: 'document+projectFacts' } },
      { organizationId: 'org_1', userId: 'user_1' },
      null,
      1,
    )
    vi.mocked(readConversationAudience).mockResolvedValueOnce(audience({}))
    expect(await conversationAudienceOf(inProduct({ decision: headless }))).toMatchObject({ solo: true, workspaceRead: 'document+projectFacts' })
    vi.mocked(readConversationAudience).mockResolvedValueOnce(audience({}))
    expect(await conversationAudienceOf(inProduct())).toMatchObject({ solo: true, workspaceRead: 'all' })
  })

  it('never widens past what the decision allows: a decision that reads nothing reads nothing', async () => {
    vi.mocked(readConversationAudience).mockResolvedValueOnce(audience({}))
    const closedDecision = { ...base, solo: true, may: { ...base.may, workspaceRead: 'none' as const } }
    expect(await conversationAudienceOf(inProduct({ decision: closedDecision }))).toMatchObject({ workspaceRead: 'none' })
  })

  it('holds a headless decision to the reach in a proposal too, though the chat is solo', async () => {
    const headless = { ...base, kind: 'headless' as const, solo: true, may: { ...base.may, workspaceRead: 'document+projectFacts' as const } }
    const targets = [{ type: 'project' as const, id: 'proj_other' }]
    vi.mocked(readConversationAudience).mockResolvedValue(audience({}))
    expect(await proposalReachRefusal(inProduct(), targets)).toBeNull()
    expect(await proposalReachRefusal(inProduct({ decision: headless }), targets)).toBe(READ_REFUSALS.proposalOutsideReach)
  })
})
