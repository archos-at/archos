/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/base-knowledge/context/corpus-countries', () => ({ corpusCountriesFor: vi.fn(async () => ['AT']) }))
vi.mock('@/lib/base-knowledge/context/service', () => ({ contextForPage: vi.fn(async () => ({ retrieval: { countries: ['AT'] } })) }))
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn(async () => ({ readsBecauseClosed: false })) }))
vi.mock('@/lib/authz/folder-access', () => ({ getProjectFolderAccess: vi.fn(async () => ({ clearedRestrictedCollections: [] })) }))
vi.mock('@/lib/projects/repository', () => ({ findProjectCollectionName: vi.fn(async () => 'proj_c') }))
vi.mock('@/lib/conversations/repository', () => ({ findConversationTenancy: vi.fn() }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn(async () => undefined) }))
vi.mock('@/lib/conversations/restricted-use-repository', () => ({ readConversationAudience: vi.fn() }))
vi.mock('@/lib/personal-shelf/repository', () => ({ hasPersonalShelfDocuments: vi.fn(async () => true) }))
vi.mock('@/lib/conversations/personal-use', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/personal-use')>()),
  recordPersonalSources: vi.fn(async () => undefined),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { findConversationTenancy } from '@/lib/conversations/repository'
import { recordPersonalSources } from '@/lib/conversations/personal-use'
import { readConversationAudience, type ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { hasPersonalShelfDocuments } from '@/lib/personal-shelf/repository'
import { personalShelfCollectionName } from '@/lib/personal-shelf/collection'
import { buildCollectionScopeFromRequest } from './collection-scope-request'

const session = { userId: 'user_me', organizationId: 'org_1', role: 'member', permissions: [] } as unknown as AuthorizedSession
const OWN_SHELF = personalShelfCollectionName('org_1', 'user_me')
const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function chat(audience: Partial<ConversationAudienceRow>): void {
  const row: ConversationAudienceRow = { exists: true, projectId: null, createdBy: 'user_me', visibility: 'private', grantees: [], ...audience }
  vi.mocked(readConversationAudience).mockResolvedValue(row)
  vi.mocked(findConversationTenancy).mockResolvedValue(
    row.exists
      ? { organizationId: 'org_1', projectId: row.projectId, visibility: row.visibility, createdBy: row.createdBy ?? 'x', deletedAt: null }
      : null
  )
}

const turn = (projectId?: string) =>
  buildCollectionScopeFromRequest(session, { conversationId: 's_chat', interactiveChat: true, ...(projectId ? { projectId } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  vi.mocked(hasPersonalShelfDocuments).mockResolvedValue(true)
})

describe('a chat without a project draws on its owner’s shelf (ADR-0191 rule 3)', () => {
  it('reads Meine Ablage as the personal shelf, and records that it did', async () => {
    chat({})

    const { scopedCollections } = await turn()

    expect(scopedCollections).toContainEqual({ collection: OWN_SHELF, shelf: 'personal' })
    expect(recordPersonalSources).toHaveBeenCalledWith('org_1', 's_chat', ['personal_shelf'])
  })

  it('does so on the first turn, before the chat has a row', async () => {
    chat({ exists: false, createdBy: null })

    expect((await turn()).scope).toContain(OWN_SHELF)
  })

  it('records nothing while the shelf is empty', async () => {
    chat({})
    vi.mocked(hasPersonalShelfDocuments).mockResolvedValue(false)

    expect((await turn()).scope).toContain(OWN_SHELF)
    expect(recordPersonalSources).not.toHaveBeenCalled()
  })

  it('leaves the shelf out when the use cannot be recorded, rather than draw on it unrecorded', async () => {
    chat({})
    vi.mocked(recordPersonalSources).mockRejectedValueOnce(new Error('db down'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect((await turn()).scope).not.toContain(OWN_SHELF)
  })
})

describe('the personal shelf stays out of every other chat (ADR-0191 rules 4 and 5)', () => {
  it('never in a project chat, even its owner’s alone', async () => {
    chat({ projectId: PROJECT_ID })

    expect((await turn()).scope).not.toContain(OWN_SHELF)
  })

  it('never in a new chat that names a project', async () => {
    chat({ exists: false, createdBy: null })

    expect((await turn(PROJECT_ID)).scope).not.toContain(OWN_SHELF)
  })

  it('never once the chat is shared', async () => {
    chat({ grantees: ['user_colleague'] })
    expect((await turn()).scope).not.toContain(OWN_SHELF)

    chat({ visibility: 'project' })
    expect((await turn()).scope).not.toContain(OWN_SHELF)
  })

  it('never for a reader who is not the chat’s owner', async () => {
    chat({ createdBy: 'user_colleague', grantees: ['user_me'] })

    expect((await turn()).scope).not.toContain(OWN_SHELF)
  })
})
