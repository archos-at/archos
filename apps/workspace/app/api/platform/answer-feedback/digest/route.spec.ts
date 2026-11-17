/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isOwner = { value: false }

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    email: 'owner@grid.com',
    role: 'admin',
  }),
}))

vi.mock('@/lib/authz/platform', () => {
  class PlatformAccessDeniedError extends Error {}
  return {
    PlatformAccessDeniedError,
    requirePlatformPermission: vi.fn().mockImplementation(async () => {
      if (!isOwner.value) throw new PlatformAccessDeniedError()
    }),
  }
})

vi.mock('@/lib/feedback/service', () => ({
  getAnswerFeedbackDigest: vi.fn().mockImplementation(async (session: unknown) => {
    const { requirePlatformPermission } = await import('@/lib/authz/platform')
    await requirePlatformPermission(session as never, 'platform:organizations:view')
    return { digest: { headline: 'Fine.' }, error: null }
  }),
}))

import { GET } from './route'
import { getAnswerFeedbackDigest } from '@/lib/feedback/service'

const request = (query = ''): Request =>
  new Request(`http://localhost/api/platform/answer-feedback/digest${query}`)

describe('GET /api/platform/answer-feedback/digest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isOwner.value = false
  })

  it('refuses a non-owner with 403', async () => {
    expect((await GET(request())).status).toBe(403)
  })

  it('passes the scope, the ratings filters and the locale through', async () => {
    isOwner.value = true
    await GET(request('?from=2026-10-01&to=2026-10-07&org=org_2&topic=fire_safety&reason=inaccurate&locale=en'))

    expect(getAnswerFeedbackDigest).toHaveBeenCalledWith(
      expect.anything(),
      {
        scope: { from: '2026-10-01', to: '2026-10-07', organizationIds: ['org_2'], projectIds: [] },
        ratings: expect.objectContaining({ topics: ['fire_safety'], reasons: ['inaccurate'] }),
      },
      { locale: 'en', refresh: false }
    )
  })

  it('refuses an unknown filter value with 400 rather than summarising something else', async () => {
    isOwner.value = true
    const res = await GET(request('?topic=nonsense'))
    expect(res.status).toBe(400)
    expect(getAnswerFeedbackDigest).not.toHaveBeenCalled()
  })

  it('forwards an explicit refresh so the button can bypass the cache', async () => {
    isOwner.value = true
    await GET(request('?refresh=1'))

    expect(getAnswerFeedbackDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ refresh: true })
    )
  })

  it('answers 200 with a reason when there is no digest to give', async () => {
    isOwner.value = true
    vi.mocked(getAnswerFeedbackDigest).mockResolvedValueOnce({
      digest: null,
      error: 'too_few_votes',
    })

    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ digest: null, error: 'too_few_votes' })
  })

  it('is never cached by the browser, so refresh means refresh', async () => {
    isOwner.value = true
    expect((await GET(request())).headers.get('Cache-Control')).toBe('no-store')
  })
})
