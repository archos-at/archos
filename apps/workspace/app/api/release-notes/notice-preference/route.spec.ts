/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'a@example.test',
    role: 'member',
    permissions: [],
  }),
}))
vi.mock('@/lib/release-notes/summary-notice', () => ({
  getReleaseNoticePreference: vi.fn().mockResolvedValue({ enabled: false }),
  setReleaseNoticePreference: vi.fn().mockResolvedValue({ enabled: true }),
}))

import { setReleaseNoticePreference } from '@/lib/release-notes/summary-notice'
import { GET, PUT } from './route'

const ctx = { params: Promise.resolve({}) }

describe('/api/release-notes/notice-preference', () => {
  it('reads the person’s switch', async () => {
    const res = await GET(new Request('http://localhost/api/release-notes/notice-preference'), ctx)
    expect(await res.json()).toEqual({ enabled: false })
  })

  it('sets it, and refuses a body without a boolean', async () => {
    const put = (body: unknown) =>
      PUT(
        new Request('http://localhost/api/release-notes/notice-preference', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        ctx,
      )
    expect(await (await put({ enabled: true })).json()).toEqual({ enabled: true })
    expect(setReleaseNoticePreference).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), true)
    expect((await put({ enabled: 'yes' })).status).toBe(400)
  })
})
