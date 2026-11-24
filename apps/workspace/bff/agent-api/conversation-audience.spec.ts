/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: vi.fn((_tenant: unknown, run: () => unknown) => run()) }))
vi.mock('@/lib/conversations/restricted-use-repository', () => ({ readConversationAudience: vi.fn() }))
vi.mock('@/lib/conversations/cross-project-use', () => ({}))
vi.mock('@/lib/cross-project/audience-reach', () => ({}))
vi.mock('@/lib/authz/folder-access-repository', () => ({ listProjectFolderTree: vi.fn() }))
vi.mock('@/lib/authz/folder-access', () => ({}))
vi.mock('./operation-targets', () => ({}))

import { readConversationAudience } from '@/lib/conversations/restricted-use-repository'
import { conversationAudienceOf } from './conversation-audience'
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
