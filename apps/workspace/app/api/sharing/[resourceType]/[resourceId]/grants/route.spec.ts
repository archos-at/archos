/**
 * @vitest-environment node
 */
/**
 * The grants route is a thin adapter over `@/lib/sharing/service`; what is
 * specified here is what it adds: `resource_shared` for PostHog, and that a
 * refused takeover leaves it as the service's 404 (ADR-0032 decision 5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'test@grid.com',
    permissions: [],
  }),
}))

vi.mock('@/lib/authz/feature-flags', () => ({
  requireCollaborationEnabled: vi.fn(() => null),
}))

vi.mock('@/lib/sharing/service', () => ({
  grantResourceAccess: vi.fn(),
  escalateToOwner: vi.fn(),
  changeResourceRole: vi.fn(),
}))

const captureServer = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer }))

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { escalateToOwner, grantResourceAccess } from '@/lib/sharing/service'
import { POST } from './route'

const post = (body: unknown) =>
  POST(
    new Request('https://grid.test/api/sharing/document/doc-1/grants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ resourceType: 'document', resourceId: 'doc-1' }) }
  )

describe('POST /api/sharing/[resourceType]/[resourceId]/grants', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports resource_shared as the sharer, with the type and role and not the invitee', async () => {
    vi.mocked(grantResourceAccess).mockResolvedValue({} as Awaited<ReturnType<typeof grantResourceAccess>>)

    const response = await post({ subjectUserId: 'user-2', role: 'viewer' })

    expect(response.status).toBe(201)
    expect(captureServer).toHaveBeenCalledWith({
      event: 'resource_shared',
      distinctId: 'user-1',
      organizationId: 'org-1',
      properties: { resource_type: 'document', audience_kind: 'person', role: 'viewer' },
    })
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('user-2')
  })

  it('reports the default role when the body names none', async () => {
    vi.mocked(grantResourceAccess).mockResolvedValue({} as Awaited<ReturnType<typeof grantResourceAccess>>)

    await post({ subjectUserId: 'user-2' })

    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ role: 'collaborator' }) })
    )
  })

  it('reports nothing when the grant is refused', async () => {
    vi.mocked(grantResourceAccess).mockRejectedValue(new ForbiddenError('no'))

    const response = await post({ subjectUserId: 'user-2' })

    expect(response.status).toBe(403)
    expect(captureServer).not.toHaveBeenCalled()
  })

  it('does not report an owner escalation as a share', async () => {
    vi.mocked(escalateToOwner).mockResolvedValue({} as Awaited<ReturnType<typeof escalateToOwner>>)

    await post({ escalate: true })

    expect(captureServer).not.toHaveBeenCalled()
  })

  it('answers a takeover of a resource the caller cannot read as not found', async () => {
    // The service refuses a project admin with no access to a private chat; the
    // route must neither soften nor explain that refusal.
    vi.mocked(escalateToOwner).mockRejectedValue(new NotFoundError())

    const response = await post({ escalate: true })

    expect(response.status).toBe(404)
    expect(escalateToOwner).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', organizationId: 'org-1' }),
      'document',
      'doc-1',
      expect.any(Request)
    )
    expect(grantResourceAccess).not.toHaveBeenCalled()
    expect(captureServer).not.toHaveBeenCalled()
  })
})
