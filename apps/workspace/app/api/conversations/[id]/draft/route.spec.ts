/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@/lib/api/errors'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    role: 'member',
    permissions: [],
  }),
}))

const requireResourceAccessMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sharing/access', () => ({
  requireResourceAccess: requireResourceAccessMock,
}))

vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

import { GET } from './route'

const fetchMock = vi.fn()

const get = (query: string) =>
  GET(new Request(`https://grid.example/api/conversations/conv-1/draft${query}`), {
    params: Promise.resolve({ id: 'conv-1' }),
  })

describe('GET /api/conversations/[id]/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_API_TOKEN = 'test-token'
    vi.stubGlobal('fetch', fetchMock)
    requireResourceAccessMock.mockResolvedValue({ role: 'viewer' })
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ path: '/entwuerfe/a.md', content: '# A\n', version: 2 }),
    })
  })

  it('proxies one conversation’s draft with the internal service token', async () => {
    const res = await get('?path=%2Fentwuerfe%2Fa.md')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      path: '/entwuerfe/a.md',
      content: '# A\n',
      version: 2,
      bytes: 4,
    })
    expect(requireResourceAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', organizationId: 'org_1' }),
      'conversation',
      'conv-1',
      'viewer',
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://backend:8000/v1/drafts/conv-1/entwuerfe/a.md')
    expect(init.method).toBe('GET')
    expect(init.headers['x-internal-token']).toBe('test-token')
  })

  it('answers 404 without addressing the backend when the reader may not see the conversation', async () => {
    requireResourceAccessMock.mockRejectedValue(new NotFoundError())

    const res = await get('?path=%2Fentwuerfe%2Fa.md')

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a backend 404 to 404', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })

    const res = await get('?path=%2Fentwuerfe%2Fa.md')

    expect(res.status).toBe(404)
  })

  it('rejects a missing path with 400 before the resource gate or any backend call', async () => {
    const res = await get('')

    expect(res.status).toBe(400)
    expect(requireResourceAccessMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
