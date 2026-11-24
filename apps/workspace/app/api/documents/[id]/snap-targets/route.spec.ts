/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION = {
  userId: 'user_1',
  organizationId: 'org_1',
  role: 'member',
  permissions: [],
  featureFlags: ['drawing-measure'],
}

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn(async () => SESSION) }))
vi.mock('@/lib/drawing-tape/snap-targets', () => ({ snapTargetsOfDocument: vi.fn() }))

import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { snapTargetsOfDocument } from '@/lib/drawing-tape/snap-targets'
import { GET } from './route'

const DOC_ID = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id: DOC_ID }) }
const url = (query: string) => `https://workspace.test/api/documents/${DOC_ID}/snap-targets${query}`

beforeEach(() => vi.clearAllMocks())

describe('GET /api/documents/[id]/snap-targets', () => {
  it('passes the page and the If-None-Match tag to the service and answers its response', async () => {
    vi.mocked(snapTargetsOfDocument).mockResolvedValue(
      new Response(null, { status: 304, headers: { ETag: '"t"' } })
    )
    const res = await GET(
      new Request(url('?page=3'), { headers: { 'If-None-Match': '"t"' } }),
      context
    )
    expect(res.status).toBe(304)
    expect(snapTargetsOfDocument).toHaveBeenCalledWith(SESSION, DOC_ID, 3, '"t"')
  })

  it('400s a missing page or an unknown field before the service runs', async () => {
    expect((await GET(new Request(url('')), context)).status).toBe(400)
    expect((await GET(new Request(url('?page=1&version=2')), context)).status).toBe(400)
    expect(snapTargetsOfDocument).not.toHaveBeenCalled()
  })

  it('answers the feature-disabled problem when the entitlement is off', async () => {
    vi.mocked(snapTargetsOfDocument).mockRejectedValue(new FeatureDisabledError('drawing-measure'))
    const res = await GET(new Request(url('?page=1')), context)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'feature_disabled' })
  })
})
