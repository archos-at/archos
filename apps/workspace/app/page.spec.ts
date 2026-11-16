import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UserSession } from '@/lib/auth/types'

const LANDING_URL = 'https://dev.piloti.at'

const redirect = vi.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})
const getUserSession = vi.fn<() => Promise<UserSession | null>>()

vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))
vi.mock('@/lib/auth/session', () => ({ getUserSession: () => getUserSession() }))

vi.mock('@workos-inc/authkit-nextjs', () => ({
  getSignInUrl: async () => {
    throw new Error('page must not call getSignInUrl during render')
  },
}))

const { default: HomePage } = await import('./page')

const session: UserSession = {
  userId: 'user_1',
  email: 'planer@example.at',
  name: 'Test Planer',
  accessToken: 'token',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'member',
  permissions: [],
  featureFlags: null,
}

const visit = async (searchParams: { 'sign-in'?: string } = {}): Promise<string> => {
  try {
    await HomePage({ searchParams: Promise.resolve(searchParams) })
  } catch (error) {
    const message = (error as Error).message
    if (message.startsWith('NEXT_REDIRECT:')) return message.slice('NEXT_REDIRECT:'.length)
    throw error
  }
  throw new Error('HomePage returned without redirecting')
}

const originalEnv = process.env

describe('HomePage redirect', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, REQUIRE_AUTH: 'true', LANDING_URL: LANDING_URL }
    redirect.mockClear()
    getUserSession.mockReset()
    getUserSession.mockResolvedValue(null)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('sends a logged-out visitor to the landing site', async () => {
    expect(await visit()).toBe(LANDING_URL)
  })

  test('sends a logged-out visitor who asked to sign in to the sign-in route', async () => {
    expect(await visit({ 'sign-in': '' })).toBe('/api/auth/signin')
  })

  test('falls back to the sign-in route when no landing site is configured', async () => {
    delete process.env.LANDING_URL

    expect(await visit()).toBe('/api/auth/signin')
  })

  test('sends a signed-in visitor to the workspace', async () => {
    getUserSession.mockResolvedValue(session)

    expect(await visit()).toBe('/app/projects')
  })

  test('sends a signed-in visitor to the workspace even with ?sign-in', async () => {
    getUserSession.mockResolvedValue(session)

    expect(await visit({ 'sign-in': '' })).toBe('/app/projects')
  })

  test('skips auth entirely when REQUIRE_AUTH is off', async () => {
    process.env.REQUIRE_AUTH = 'false'

    expect(await visit()).toBe('/app/projects')
    expect(getUserSession).not.toHaveBeenCalled()
  })
})
