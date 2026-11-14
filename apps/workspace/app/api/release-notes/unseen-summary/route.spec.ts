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
vi.mock('@/lib/release-notes/summary-notice', () => ({ getUnseenReleaseSummary: vi.fn().mockResolvedValue(null) }))

import { GET } from './route'

describe('GET /api/release-notes/unseen-summary', () => {
  it('answers `{ summary: null }` once there is nothing to show', async () => {
    const res = await GET(new Request('http://localhost/api/release-notes/unseen-summary'), {
      params: Promise.resolve({}),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ summary: null })
  })
})
