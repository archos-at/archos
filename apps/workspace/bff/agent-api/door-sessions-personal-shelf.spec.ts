/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authz/project-membership', () => ({ resolveSubjectMembership: vi.fn(), lookupSubjectMembership: vi.fn() }))
vi.mock('@/lib/workos/feature-flags', () => ({ enabledFlagsForOrganization: vi.fn(async () => []) }))
vi.mock('@/lib/auth/person', () => ({ resolvePerson: vi.fn(async () => ({ name: null, email: null, organizationName: null })) }))
vi.mock('@/lib/authz/org-role-permissions', () => ({ rolePermissions: vi.fn(async () => new Set<string>()) }))
vi.mock('@/lib/documents/repository', () => ({ findDocumentInOrg: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/authz/folder-access', () => ({ isFolderVisibleTo: vi.fn(), requireFolderWrite: vi.fn() }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn() }))
vi.mock('@/lib/authz/organizations', () => ({ canManageOfficeShelf: vi.fn() }))

import { runAsActingSession } from '@/lib/agent-api/acting-session'
import { NotFoundError } from '@/lib/api/errors'
import { resolveMemberSession, resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { resolveSubjectMembership } from '@/lib/authz/project-membership'
import { getAccessibleDocument } from '@/lib/documents/access'
import { findDocumentInOrg } from '@/lib/documents/repository'
import { makeDocument } from '@/test-utils/db-fixtures'

const person = { userId: 'u-me', email: null, organizationId: 'org-1' }
const own = makeDocument({ id: 'd-own', organizationId: 'org-1', scope: 'personal', projectId: null, ownerUserId: 'u-me' })
const theirs = { ...own, id: 'd-theirs', ownerUserId: 'u-colleague' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveSubjectMembership).mockResolvedValue({ organizationMembershipId: 'om-1', role: 'member', roles: ['member'] })
  vi.mocked(findDocumentInOrg).mockImplementation(async (id: string) => (id === own.id ? own : id === theirs.id ? theirs : null))
})

describe('the sessions an agent door acts with, and Meine Ablage (ADR-0193)', () => {
  it('lets the person’s own mcp agent, with the session principal.ts builds, read its own shelf', async () => {
    const session = (await resolveMemberSession(person))!
    expect(session.pinnedForTurn).toBeUndefined()
    const read = await runAsActingSession(session, () => getAccessibleDocument(session, own.id), 'agent', { door: 'mcp', sessionSource: 'mcp' })
    expect(read.id).toBe(own.id)
  })

  it('never lets that mcp agent reach a colleague’s shelf', async () => {
    const session = (await resolveMemberSession(person))!
    await expect(
      runAsActingSession(session, () => getAccessibleDocument(session, theirs.id), 'agent', { door: 'mcp', sessionSource: 'mcp' })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('gives the in-product agent’s pinned turn session none of it, its own requester’s included', async () => {
    const pinned = (await resolvePinnedRequesterSession(person))!
    expect(pinned.pinnedForTurn).toBe(true)
    await expect(getAccessibleDocument(pinned, own.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})
