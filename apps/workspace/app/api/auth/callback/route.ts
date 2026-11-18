import { CallbackError, handleAuth } from '@workos-inc/authkit-nextjs'
import { type NextRequest, NextResponse } from 'next/server'
import { captureServer } from '@/lib/analytics/posthog-server'
import { tenantSlotRoute } from '@/lib/db/tenant-context'

const redirectUri = process.env.WORKOS_REDIRECT_URI ?? process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
const baseURL = redirectUri ? new URL(redirectUri).origin : undefined

const NEW_USER_WINDOW_MS = 10 * 60_000

type HandleAuthOptions = NonNullable<Parameters<typeof handleAuth>[0]>
type SignInData = Parameters<NonNullable<HandleAuthOptions['onSuccess']>>[0]

const announceSignIn = ({ user, organizationId, authenticationMethod }: SignInData): void => {
  const createdAt = user.createdAt.getTime()
  captureServer({
    event: 'user_signed_in',
    distinctId: user.id,
    organizationId: organizationId ?? null,
    properties: {
      method: authenticationMethod,
      is_new_user: Number.isNaN(createdAt) ? undefined : Date.now() - createdAt < NEW_USER_WINDOW_MS,
    },
  })
}

const LOST_FLOW_CODES = new Set<string>(['missing_pkce_cookie', 'oauth_state_mismatch'])

function reportSignInFailure({ error, request }: { error?: unknown; request: NextRequest }): Response {
  const code = error instanceof CallbackError && LOST_FLOW_CODES.has(error.code) ? 'SessionExpired' : 'Default'
  return NextResponse.redirect(new URL(`/auth/error?error=${code}`, baseURL ?? request.url))
}

const authkitCallback = handleAuth({
  returnPathname: '/app/projects',
  baseURL,
  onSuccess: announceSignIn,
  onError: reportSignInFailure,
})

async function callback(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url)
  if (!searchParams.has('code') && !searchParams.has('state')) {
    console.debug('[auth] callback without code or state; redirecting to sign-in', {
      userAgent: request.headers.get('user-agent') ?? undefined,
    })
    return NextResponse.redirect(new URL('/api/auth/signin', baseURL ?? request.url))
  }
  return authkitCallback(request)
}

export const GET = tenantSlotRoute(callback)
