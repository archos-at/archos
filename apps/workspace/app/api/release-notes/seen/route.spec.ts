/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'a@example.test',
    role: 'member',
    permissions: [],
  }),
}))
vi.mock('@/lib/release-notes/summary-notice', () => ({ markReleaseSummarySeen: vi.fn() }))

import { markReleaseSummarySeen } from '@/lib/release-notes/summary-notice'
import { POST } from './route'

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/release-notes/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )

describe('POST /api/release-notes/seen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records the week for the person in the session, with "stop" when asked', async () => {
    vi.mocked(markReleaseSummarySeen).mockResolvedValue({ lastSeenWeek: '2026-W44', enabled: false })
    const res = await post({ week: '2026-W44', stop: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ lastSeenWeek: '2026-W44', enabled: false })
    expect(markReleaseSummarySeen).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), '2026-W44', {
      stop: true,
    })
  })

  it('refuses anything that is not an ISO week', async () => {
    expect((await post({ week: 'last week' })).status).toBe(400)
    expect((await post({ week: '2026-W54' })).status).toBe(400)
    expect(markReleaseSummarySeen).not.toHaveBeenCalled()
  })
})
