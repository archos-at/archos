/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'test@grid.com',
    role: 'admin',
  }),
}))

vi.mock('@/lib/project-experience/service', () => ({
  extractProjectExperience: vi.fn().mockResolvedValue({ suggested: 2, drafted: 1, documentsRead: ['a.pdf'], error: null }),
}))

import { SessionRequiredError } from '@/lib/api/errors'
import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import { extractProjectExperience } from '@/lib/project-experience/service'
import { POST } from './route'

const PROJECT_ID = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'

function call() {
  const request = new Request(`https://grid.test/api/projects/${PROJECT_ID}/experience`, { method: 'POST' })
  return POST(request, { params: Promise.resolve({ id: PROJECT_ID }) })
}

describe('POST /api/projects/[id]/experience', () => {
  it('refuses a caller without a signed-in session before the service runs', async () => {
    vi.mocked(requireAuthorizedSession).mockRejectedValueOnce(new SessionRequiredError())

    const response = await call()

    expect(response.status).toBe(403)
    expect(extractProjectExperience).not.toHaveBeenCalled()
  })

  it('hands the project id to the service and returns its result', async () => {
    const response = await call()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ suggested: 2, drafted: 1, documentsRead: ['a.pdf'], error: null })
    expect(extractProjectExperience).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1' }), PROJECT_ID)
  })
})
