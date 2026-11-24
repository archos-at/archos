/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: vi.fn((_tenant: unknown, run: () => unknown) => run()) }))
vi.mock('@/lib/cross-project/audience-reach', () => ({ audienceReachAmong: vi.fn() }))
vi.mock('@/lib/authz/folder-access-repository', () => ({ listProjectFolderTree: vi.fn(async () => []) }))
vi.mock('@/lib/conversations/personal-use', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/personal-use')>()),
  recordPersonalSources: vi.fn(async () => undefined),
}))
vi.mock('./operation-targets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./operation-targets')>()),
  placesOf: vi.fn(),
}))

import { AGENT_KIND } from '@/lib/agent-kind'
import { recordPersonalSources } from '@/lib/conversations/personal-use'
import type { ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { READ_REFUSALS, judgeWorkspaceRead, recordPersonalRead, type ConversationAudience } from './conversation-audience'
import { placesOf } from './operation-targets'
import type { AgentPrincipal } from './principal'

const session = {
  userId: 'user_1',
  email: 'a@example.test',
  name: null,
  accessToken: '',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'member' as const,
  permissions: [],
  featureFlags: null,
}

const principal = (projectId: string | null): AgentPrincipal => ({
  actor: AGENT_KIND,
  session,
  clientId: null,
  scopes: [],
  conversationId: 'conv_1',
  projectId: projectId ?? undefined,
  answerMessageId: null,
})

const audience = (row: Partial<ConversationAudienceRow>): ConversationAudience => {
  const full: ConversationAudienceRow = { exists: true, projectId: null, createdBy: 'user_1', visibility: 'private', grantees: [], ...row }
  return { row: full, solo: full.visibility === 'private' && full.grantees.length === 0, key: 'k' }
}

const documentGet = { path: '/api/documents/[id]' } as const
const readOwnFile = (who: AgentPrincipal, where: ConversationAudience) =>
  judgeWorkspaceRead(who, where, documentGet, { params: { id: '6f1c2b8e-3d4a-4b6c-8d7e-9f0a1b2c3d4e' } }, 'document', async () => [])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(placesOf).mockResolvedValue([
    { projectId: null, conversationId: null, document: { folderId: null, passedScreening: true }, personal: true },
  ])
})

describe('the agent opens a document on the person’s own shelf only where the shelf may be drawn on (ADR-0191)', () => {
  it('opens it in the owner’s chat without a project, and marks the read as personal', async () => {
    expect(await readOwnFile(principal(null), audience({}))).toMatchObject({ personal: true })
  })

  it('refuses it in a project chat, even the owner’s alone (rule 4)', async () => {
    expect(await readOwnFile(principal('proj_1'), audience({ projectId: 'proj_1' }))).toEqual({
      refusal: READ_REFUSALS.personal,
    })
  })

  it('refuses it once the chat is shared (rule 5)', async () => {
    expect(await readOwnFile(principal(null), audience({ grantees: ['user_2'] }))).toHaveProperty('refusal')
  })

  it('records a personal read on the chat', async () => {
    await recordPersonalRead(principal(null))
    expect(recordPersonalSources).toHaveBeenCalledWith('org_1', 'conv_1', ['personal_shelf'])
  })
})
