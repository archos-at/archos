/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/base-knowledge/context/corpus-countries', () => ({ corpusCountriesFor: vi.fn(async () => ['AT']) }))
vi.mock('@/lib/base-knowledge/context/service', () => ({ contextForPage: vi.fn(async () => ({ retrieval: { countries: ['AT'] } })) }))
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/conversations/restricted-use', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/conversations/restricted-use')>()),
  peopleWhoMayRead: vi.fn(async (_org: string, _id: string, userIds: readonly string[]) => new Set(userIds)),
  lockedConversationIds: vi.fn(async () => new Set<string>()),
}))

vi.mock('@/lib/conversations/repository', () => ({ findConversationTenancy: vi.fn() }))
vi.mock('@/lib/sharing/repository', () => ({ findGrantForSubject: vi.fn() }))

import { isAuthzRefusal, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import { ForbiddenError } from '@/lib/api/errors'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { findConversationTenancy } from '@/lib/conversations/repository'
import { getDb } from '@/lib/db'
import { findGrantForSubject } from '@/lib/sharing/repository'
import { buildCollectionScopeFromRequest, ConversationProjectMismatchError } from './collection-scope-request'

const CONVERSATION_ID = 'conv_private_of_a_colleague'
const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const session = {
  userId: 'user_me',
  organizationId: 'org_1',
  email: 'me@example.test',
  role: 'member',
  roles: ['member'],
  permissions: [],
} as unknown as AuthorizedSession

function stubDb(): void {
  const limit = vi.fn().mockResolvedValue([])
  vi.mocked(getDb).mockReturnValue({
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  stubDb()
  vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor', closed: false, readsBecauseClosed: false })
  vi.mocked(findGrantForSubject).mockResolvedValue(null)
})

describe('a conversationId on the WS upgrade is authorized (F2)', () => {
  it('refuses an existing conversation the caller cannot reach, and the refusal reads as an authz error', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'private',
      createdBy: 'user_colleague',
      deletedAt: null,
    })

    const failure = await buildCollectionScopeFromRequest(session, {
      conversationId: CONVERSATION_ID,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(NotFoundError)
    expect(isAuthzRefusal(failure)).toBe(true)
  })

  it('refuses a conversation in another organization', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_2',
      projectId: null,
      visibility: 'project',
      createdBy: 'user_me',
      deletedAt: null,
    })

    await expect(
      buildCollectionScopeFromRequest(session, { conversationId: CONVERSATION_ID }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('ALLOWS a brand-new client-generated id that does not exist yet — the first-message path', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue(null)

    const result = await buildCollectionScopeFromRequest(session, {
      conversationId: 'conv_brand_new',
    })

    expect(result.conversationId).toBe('conv_brand_new')
    expect(result.scope).toContain('s_conv_brand_new')
    expect(result.verifiedConversationId).toBeUndefined()
  })

  it('allows a conversation the caller created', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'private',
      createdBy: session.userId,
      deletedAt: null,
    })

    const result = await buildCollectionScopeFromRequest(session, {
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
    })

    expect(result.conversationId).toBe(CONVERSATION_ID)
    expect(result.verifiedConversationId).toBe(CONVERSATION_ID)
  })

  it('allows a thread shared with the caller by an explicit grant', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId: PROJECT_ID,
      visibility: 'private',
      createdBy: 'user_colleague',
      deletedAt: null,
    })
    vi.mocked(findGrantForSubject).mockResolvedValue({ role: 'collaborator' } as never)

    const result = await buildCollectionScopeFromRequest(session, {
      conversationId: CONVERSATION_ID,
    })

    expect(result.conversationId).toBe(CONVERSATION_ID)
  })

  it('never probes a conversation when the request carries no conversation id', async () => {
    await buildCollectionScopeFromRequest(session, { projectId: PROJECT_ID })

    expect(findConversationTenancy).not.toHaveBeenCalled()
  })
})

describe('a caller who reads a closed project only because it is closed (ADR-0090)', () => {
  it('is reported as read-only, so the job envelope signs them no project', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValue({
      role: 'project-viewer',
      closed: true,
      readsBecauseClosed: true,
    })

    const result = await buildCollectionScopeFromRequest(session, { projectId: PROJECT_ID })

    expect(result.projectId).toBe(PROJECT_ID)
    expect(result.projectReadOnly).toBe(true)
  })

  it('a member of the closed project is not', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor', closed: true, readsBecauseClosed: false })

    const result = await buildCollectionScopeFromRequest(session, { projectId: PROJECT_ID })

    expect(result.projectReadOnly).toBe(false)
  })
})

describe('the conversation row decides which project a turn reads (ADR-0193 rule 2)', () => {
  const OTHER_PROJECT = '9a1c7e00-4f89-11d3-9a0c-0305e82c3302'

  function ownRow(projectId: string | null): void {
    vi.mocked(findConversationTenancy).mockResolvedValue({
      organizationId: 'org_1',
      projectId,
      visibility: 'private',
      createdBy: session.userId,
      deletedAt: null,
    })
  }

  it('reads the row’s project when the request names none', async () => {
    ownRow(PROJECT_ID)

    const result = await buildCollectionScopeFromRequest(session, { conversationId: CONVERSATION_ID })

    expect(result.projectId).toBe(PROJECT_ID)
    expect(requireProjectAccess).toHaveBeenCalledWith(session, PROJECT_ID, expect.anything())
  })

  it('keeps a viewer of the chat in it without the project, when the request named none and the chat rights are missing', async () => {
    ownRow(PROJECT_ID)
    const allowed = { role: 'project-viewer' as const, closed: false, readsBecauseClosed: false }
    vi.mocked(requireProjectAccess).mockImplementation(async (_session, _project, permissions) => {
      if (permissions === CHAT_PERMISSIONS) throw new ForbiddenError('no chat rights')
      return allowed as never
    })

    const result = await buildCollectionScopeFromRequest(session, { conversationId: CONVERSATION_ID })

    expect(result.projectId).toBeUndefined()
    expect(result.scope.some((collection) => collection.startsWith('proj_'))).toBe(false)
    await expect(
      buildCollectionScopeFromRequest(session, { conversationId: CONVERSATION_ID, projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a request that names another project than the row', async () => {
    ownRow(PROJECT_ID)

    const failure = await buildCollectionScopeFromRequest(session, {
      conversationId: CONVERSATION_ID,
      projectId: OTHER_PROJECT,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConversationProjectMismatchError)
    expect(isAuthzRefusal(failure)).toBe(true)
  })

  it('refuses a project for a chat without one, so the page’s open project is never a source', async () => {
    ownRow(null)

    await expect(
      buildCollectionScopeFromRequest(session, { conversationId: CONVERSATION_ID, projectId: PROJECT_ID }),
    ).rejects.toBeInstanceOf(ConversationProjectMismatchError)
  })

  it('reads no project for a chat without one', async () => {
    ownRow(null)

    const result = await buildCollectionScopeFromRequest(session, { conversationId: CONVERSATION_ID })

    expect(result.projectId).toBeUndefined()
    expect(result.scope.some((collection) => collection.startsWith('proj_'))).toBe(false)
    expect(requireProjectAccess).not.toHaveBeenCalled()
  })

  it('takes the request’s project for a first turn whose row does not exist yet', async () => {
    vi.mocked(findConversationTenancy).mockResolvedValue(null)

    const result = await buildCollectionScopeFromRequest(session, {
      conversationId: 'conv_brand_new',
      projectId: PROJECT_ID,
    })

    expect(result.projectId).toBe(PROJECT_ID)
    expect(requireProjectAccess).toHaveBeenCalledWith(session, PROJECT_ID, expect.anything())
  })
})
