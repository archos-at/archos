/**
 * @vitest-environment node
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { ForbiddenError, isAuthzRefusal, NoOrganizationError, NotFoundError, SessionRequiredError } from '@/lib/api/errors'

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`)
    this.name = 'RedirectError'
  }
}

vi.mock('./session', () => ({
  requireUserSession: vi.fn(),
}))

class NotFoundSignal extends Error {
  constructor() {
    super('NEXT_HTTP_ERROR_FALLBACK;404')
  }
}

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url)
  }),
  notFound: vi.fn(() => {
    throw new NotFoundSignal()
  }),
}))

import { requireUserSession } from './session'
import { redirect } from 'next/navigation'
import {
  requireAuthorizedSession,
  requireAuthorizedPageSession,
  withPageSession,
} from './require-auth'
import type { AuthorizedSession, UserSession } from './types'

const authorizedSession: AuthorizedSession = {
  userId: 'user-1',
  email: 'test@grid.com',
  name: 'Test User',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'mem-1',
  role: 'admin',
  permissions: [],
  featureFlags: null,
}

const sessionWithoutOrg: UserSession = {
  ...authorizedSession,
  organizationId: null,
  organizationMembershipId: null,
}

describe('require-auth guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requireAuthorizedSession throws a NoOrganizationError treated as authz error when no organization', async () => {
    vi.mocked(requireUserSession).mockResolvedValue(sessionWithoutOrg)

    let caught: unknown
    try {
      await requireAuthorizedSession()
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(NoOrganizationError)
    expect(isAuthzRefusal(caught)).toBe(true)
    expect((caught as NoOrganizationError).status).toBe(403)
  })

  it('requireAuthorizedPageSession redirects to organization onboarding when no organization', async () => {
    vi.mocked(requireUserSession).mockResolvedValue(sessionWithoutOrg)

    await expect(requireAuthorizedPageSession()).rejects.toThrow(RedirectError)
    expect(redirect).toHaveBeenCalledWith('/app/onboarding/organization')
  })

  it('both guards resolve to the session when an organization is selected', async () => {
    vi.mocked(requireUserSession).mockResolvedValue(authorizedSession)

    await expect(requireAuthorizedSession()).resolves.toBe(authorizedSession)
    await expect(requireAuthorizedPageSession()).resolves.toBe(authorizedSession)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('requireAuthorizedPageSession rethrows non-org errors without redirecting', async () => {
    vi.mocked(requireUserSession).mockRejectedValue(new SessionRequiredError())

    await expect(requireAuthorizedPageSession()).rejects.toThrow(
      'Unauthorized: Grid session required',
    )
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('withPageSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserSession).mockResolvedValue(authorizedSession)
  })

  it('answers a page whose project is gone or not the visitor\'s with the 404 page, not the error boundary (KAN-99)', async () => {
    await expect(
      withPageSession(async () => {
        throw new NotFoundError()
      })
    ).rejects.toBeInstanceOf(NotFoundSignal)
  })

  it('passes the page result and every other error through', async () => {
    await expect(withPageSession(async (session) => session.organizationId)).resolves.toBe('org-1')
    const denied = new ForbiddenError()
    await expect(
      withPageSession(async () => {
        throw denied
      })
    ).rejects.toBe(denied)
  })
})
