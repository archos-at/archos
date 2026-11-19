/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = {
  userId: 'user_01JCX0R4D8M2W6YB3N5Q7T9V1A',
  organizationId: 'org_1',
  email: 'lena@example.test',
  role: 'member',
  permissions: [] as string[],
}

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockImplementation(async () => session),
  authzErrorResponse: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/inbound-mail/address-service', async () => {
  const { NotFoundError } = await import('@/lib/api/errors')
  const view = { state: 'active', address: 'project+haus.abcdefgh2345@inbox.example.org', canManage: true, lastReceivedAt: null, droppedLast30Days: 0, ownDomainVerifiedShare: null }
  return {
    getInboundMailAddress: vi.fn().mockImplementation(async (_s: unknown, projectId: string) => {
      if (projectId === 'hidden') throw new NotFoundError()
      return { ...view, state: 'none', address: null }
    }),
    createInboundMailAddress: vi.fn().mockResolvedValue(view),
    deleteInboundMailAddress: vi.fn().mockResolvedValue({ ...view, state: 'none', address: null }),
    setInboundMailForwardedFrom: vi.fn().mockResolvedValue({ ...view, forwardedFrom: ['projekt@buero.at'] }),
  }
})

import { createInboundMailAddress, deleteInboundMailAddress, getInboundMailAddress, setInboundMailForwardedFrom } from '@/lib/inbound-mail/address-service'
import { DELETE, GET, PATCH, POST } from './route'

const url = 'http://localhost/api/projects/3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/inbound-mail-address'
const ctx = (id = '3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d') => ({ params: Promise.resolve({ id }) })

describe('/api/projects/[id]/inbound-mail-address', () => {
  beforeEach(() => vi.clearAllMocks())

  it('GET answers the address as the session reads it, and never creates one', async () => {
    const res = await GET(new Request(url), ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).state).toBe('none')
    expect(getInboundMailAddress).toHaveBeenCalledWith(session, '3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')
    expect(createInboundMailAddress).not.toHaveBeenCalled()
  })

  it('GET answers 404 for a project whose mail the caller may not review', async () => {
    expect((await GET(new Request(url), ctx('hidden'))).status).toBe(404)
  })

  it('POST creates the address as the caller; DELETE switches it off', async () => {
    expect((await POST(new Request(url, { method: 'POST' }), ctx())).status).toBe(200)
    expect(createInboundMailAddress).toHaveBeenCalledWith(session, '3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')
    expect((await DELETE(new Request(url, { method: 'DELETE' }), ctx())).status).toBe(200)
    expect(deleteInboundMailAddress).toHaveBeenCalledWith(session, '3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')
  })

  it('PATCH replaces the forwarding addresses as the caller, and refuses a body that is not the list', async () => {
    const patch = (body: unknown) =>
      PATCH(new Request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx())
    const res = await patch({ forwardedFrom: ['Projekt@buero.at'] })
    expect(res.status).toBe(200)
    expect((await res.json()).forwardedFrom).toEqual(['projekt@buero.at'])
    expect(setInboundMailForwardedFrom).toHaveBeenCalledWith(session, '3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', { forwardedFrom: ['Projekt@buero.at'] })
    expect((await patch({ forwardedFrom: 'projekt@buero.at' })).status).toBe(400)
    expect((await patch({ forwardedFrom: Array.from({ length: 11 }, (_, n) => `p${n}@buero.at`) })).status).toBe(400)
    expect(setInboundMailForwardedFrom).toHaveBeenCalledTimes(1)
  })
})
