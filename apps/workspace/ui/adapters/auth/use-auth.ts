'use client'

import { useCallback, useMemo } from 'react'
import { useAuth as useAuthKit, useAccessToken } from '@workos-inc/authkit-nextjs/components'
import { useAppConfig } from '@/shared/context'
import { resetPosthog } from '@/lib/analytics/posthog'
import { forgetThisDevice } from '@/lib/push/browser'
import { pushClient } from '@/lib/push/client'
import type { AuthContext } from './types'

const DEFAULT_USER = {
  id: 'default-user',
  name: 'Default User',
  email: null,
  image: null,
}

export const useAuth = (): AuthContext => {
  const { authRequired } = useAppConfig()
  const {
    user,
    organizationId: authKitOrganizationId,
    loading: sessionLoading,
    getAuth,
    signOut: authKitSignOut,
  } = useAuthKit()
  const {
    accessToken,
    loading: tokenLoading,
    error: tokenError,
    getAccessToken,
  } = useAccessToken()

  const handleSignIn = useCallback(async (): Promise<void> => {
    if (!authRequired) return
    await getAuth({ ensureSignedIn: true })
  }, [authRequired, getAuth])

  const handleSignOut = useCallback(async (): Promise<void> => {
    if (!authRequired) return
    resetPosthog()
    await forgetThisDevice(pushClient, { serverWithinMs: 1500 })
    await authKitSignOut({ returnTo: '/' })
  }, [authRequired, authKitSignOut])

  const name = useMemo(() => {
    if (!user) return null
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`
    }
    return user.firstName || user.lastName || user.name || null
  }, [user])

  if (!authRequired) {
    return {
      isAuthenticated: true,
      isLoading: false,
      authRequired: false,
      user: DEFAULT_USER,
      accessToken: undefined,
      idToken: undefined,
      organizationId: undefined,
      error: undefined,
      signIn: async () => {},
      signOut: async () => {},
      getAccessToken: async () => undefined,
    }
  }

  const isLoading = sessionLoading || tokenLoading
  const isAuthenticated = !!user && !!accessToken

  return {
    isAuthenticated,
    isLoading,
    authRequired: true,
    user: user
      ? {
          id: user.id,
          email: user.email,
          name,
          image: user.profilePictureUrl ?? null,
        }
      : null,
    accessToken,
    idToken: accessToken,
    organizationId: authKitOrganizationId,
    error: tokenError?.message,
    signIn: handleSignIn,
    signOut: handleSignOut,
    getAccessToken,
  }
}
