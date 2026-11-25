import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuth } from './use-auth'

const session = { user: null as null | { id: string; firstName: string; lastName: string; email: string }, loading: false }
const token = { accessToken: undefined as string | undefined, loading: false, error: null as null | Error }

vi.mock('@workos-inc/authkit-nextjs/components', () => ({
  useAuth: () => ({ ...session, organizationId: 'org-1', getAuth: vi.fn(), signOut: vi.fn() }),
  useAccessToken: () => ({ ...token, getAccessToken: vi.fn() }),
}))
const config = { authRequired: true }
vi.mock('@/shared/context', () => ({ useAppConfig: () => config }))
vi.mock('@/lib/analytics/posthog', () => ({ resetPosthog: vi.fn() }))
vi.mock('@/lib/push/browser', () => ({ forgetThisDevice: vi.fn() }))
vi.mock('@/lib/push/client', () => ({ pushClient: {} }))

const anna = { id: 'u-1', firstName: 'Anna', lastName: 'Berger', email: 'anna@example.test' }

describe('useAuth', () => {
  beforeEach(() => {
    config.authRequired = true
    session.user = null
    session.loading = false
    Object.assign(token, { accessToken: undefined, loading: false, error: null })
  })

  test('a session whose token has not been fetched yet is still loading, so nobody is asked to sign in for the frame before the fetch starts', () => {
    session.user = anna
    const { result } = renderHook(() => useAuth())
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.isLoading).toBe(true)
  })

  test('a session with its token is signed in and settled', () => {
    session.user = anna
    token.accessToken = 'token'
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ isAuthenticated: true, isLoading: false })
  })

  test('a token that failed settles the load without a sign-in', () => {
    session.user = anna
    token.error = new Error('refresh failed')
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ isAuthenticated: false, isLoading: false, error: 'refresh failed' })
  })

  test('a visitor with no session, once both loads are done, is signed out and settled, so the sign-in prompt shows', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ isAuthenticated: false, isLoading: false, user: null })
  })

  test('without sign-in (no auth required) it is never loading, with no AuthKit user and no token', () => {
    config.authRequired = false
    session.loading = true
    token.loading = true
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ isAuthenticated: true, isLoading: false, authRequired: false })
  })
})
