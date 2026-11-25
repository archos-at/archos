import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuth } from './use-auth'

const session = { user: null as null | { id: string; firstName: string; lastName: string; email: string }, loading: false }
const token = { accessToken: undefined as string | undefined, loading: false, error: null as null | Error }

vi.mock('@workos-inc/authkit-nextjs/components', () => ({
  useAuth: () => ({ ...session, organizationId: 'org-1', getAuth: vi.fn(), signOut: vi.fn() }),
  useAccessToken: () => ({ ...token, getAccessToken: vi.fn() }),
}))
vi.mock('@/shared/context', () => ({ useAppConfig: () => ({ authRequired: true }) }))
vi.mock('@/lib/analytics/posthog', () => ({ resetPosthog: vi.fn() }))
vi.mock('@/lib/push/browser', () => ({ forgetThisDevice: vi.fn() }))
vi.mock('@/lib/push/client', () => ({ pushClient: {} }))

const anna = { id: 'u-1', firstName: 'Anna', lastName: 'Berger', email: 'anna@example.test' }

describe('useAuth', () => {
  beforeEach(() => {
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

  test('no session, settled: signed out', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current).toMatchObject({ isAuthenticated: false, isLoading: false })
  })
})
