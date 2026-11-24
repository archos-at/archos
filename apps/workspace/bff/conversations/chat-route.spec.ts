import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
const tenancy = vi.hoisted(() => vi.fn())
const access = vi.hoisted(() => vi.fn())
vi.mock('./repository', () => ({ findConversationTenancy: tenancy }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: access }))

import { chatRouteElsewhere, chatRouteOf } from './chat-route'

const session = { organizationId: 'org-1', userId: 'u-1', organizationMembershipId: 'm-1' } as AuthorizedSession
const row = (projectId: string | null, organizationId = 'org-1') => ({
  organizationId,
  projectId,
  visibility: 'private',
  createdBy: 'u-1',
  deletedAt: null,
})

beforeEach(() => {
  tenancy.mockReset()
  access.mockReset().mockResolvedValue({ role: 'owner' })
})

describe('a chat page shows only a chat of its own side (the owner’s report from staging, 2026-11-24)', () => {
  it('a personal chat named on a project’s chat page goes to the personal chat', async () => {
    tenancy.mockResolvedValue(row(null))
    expect(await chatRouteElsewhere(session, 's_dere', 'p1')).toBe('/app/personal/chat?session=s_dere')
  })

  it('a project chat named on the personal chat page goes to its project', async () => {
    tenancy.mockResolvedValue(row('p1'))
    expect(await chatRouteElsewhere(session, 's_holz', null)).toBe('/app/projects/p1/chat?session=s_holz')
  })

  it('another project’s chat goes to that project', async () => {
    tenancy.mockResolvedValue(row('p2'))
    expect(await chatRouteElsewhere(session, 's_b', 'p1')).toBe('/app/projects/p2/chat?session=s_b')
  })

  it('a chat of this side stays, and so does an id the server does not hold yet (a first message)', async () => {
    tenancy.mockResolvedValue(row('p1'))
    expect(await chatRouteElsewhere(session, 's_a', 'p1')).toBeNull()
    tenancy.mockResolvedValue(row(null))
    expect(await chatRouteElsewhere(session, 's_me', null)).toBeNull()
    tenancy.mockResolvedValue(null)
    expect(await chatRouteElsewhere(session, 's_new', 'p1')).toBeNull()
  })

  it('a chat the reader may not see is dropped to a new chat here, never naming where it lives', async () => {
    tenancy.mockResolvedValue(row('p-secret'))
    access.mockRejectedValue(new ForbiddenError('no'))
    expect(await chatRouteElsewhere(session, 's_x', null)).toBe('/app/personal/chat')
  })

  it('a chat of another office is dropped without asking who may see it', async () => {
    tenancy.mockResolvedValue(row('p9', 'org-2'))
    expect(await chatRouteElsewhere(session, 's_y', 'p1')).toBe('/app/projects/p1/chat')
    expect(access).not.toHaveBeenCalled()
  })

  it('encodes what it puts into the route', () => {
    expect(chatRouteOf('a b', 's/1')).toBe('/app/projects/a%20b/chat?session=s%2F1')
  })
})
