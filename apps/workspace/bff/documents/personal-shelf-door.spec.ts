import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({ findDocumentInOrg: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/authz/folder-access', () => ({ isFolderVisibleTo: vi.fn(), requireFolderWrite: vi.fn() }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn() }))
vi.mock('@/lib/authz/organizations', () => ({ canManageOfficeShelf: vi.fn() }))

import { runAsActingSession } from '@/lib/agent-api/acting-session'
import type { CallDoor } from '@/lib/agent-api/call-door'
import { callDoorOf } from '@/lib/agent-api/call-origin'
import type { AgentPrincipal } from '@/lib/agent-api/principal'
import { AGENT_KIND } from '@/lib/agent-kind'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { makeDocument } from '@/test-utils/db-fixtures'
import { getAccessibleDocument } from './access'
import { mayReachPersonalShelf } from './personal-shelf-door'
import { findDocumentInOrg } from './repository'
import { personalShelf } from './shelf'
import { requireShelfRead } from './shelf-authz'

const me = { organizationId: 'org-1', userId: 'u-me' } as AuthorizedSession
const through = <T>(door: CallDoor, fn: () => Promise<T>): Promise<T> =>
  runAsActingSession(me, fn, 'agent', { door, sessionSource: door === 'mcp' ? 'mcp' : 'ui' })

beforeEach(() => vi.clearAllMocks())

const IN_PRODUCT_DOOR = callDoorOf({ principal: { actor: AGENT_KIND } as AgentPrincipal })

describe('which doors reach a person’s own shelf (ADR-0191)', () => {
  it('lets the person in the app and their own mcp agent in', async () => {
    expect(mayReachPersonalShelf()).toBe(true)
    expect(await through('mcp', async () => mayReachPersonalShelf())).toBe(true)
  })

  it.each<CallDoor>(['a2a', 'platform', IN_PRODUCT_DOOR])('lets the %s door reach nothing', async (door) => {
    expect(await through(door, async () => mayReachPersonalShelf())).toBe(false)
    await expect(through(door, () => requireShelfRead(me, personalShelf('u-me')))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses an acting call that names no door', async () => {
    expect(await runAsActingSession(me, async () => mayReachPersonalShelf(), 'agent')).toBe(false)
  })
})

describe('an mcp caller never reaches a colleague’s shelf', () => {
  it('reads its own document, and finds none of a colleague’s', async () => {
    const own = makeDocument({ id: 'd-own', scope: 'personal', projectId: null, ownerUserId: 'u-me' })
    vi.mocked(findDocumentInOrg).mockResolvedValue(own)
    await expect(through('mcp', () => getAccessibleDocument(me, 'd-own'))).resolves.toBe(own)

    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...own, id: 'd-theirs', ownerUserId: 'u-colleague' })
    await expect(through('mcp', () => getAccessibleDocument(me, 'd-theirs'))).rejects.toBeInstanceOf(NotFoundError)
    await expect(through('mcp', () => requireShelfRead(me, personalShelf('u-colleague')))).rejects.toBeInstanceOf(NotFoundError)
  })
})
