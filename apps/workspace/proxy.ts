import { authkitMiddleware } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { isAuthRequired } from '@/lib/auth/auth-required'
import { SIGNED_IN_COOKIE_NAME, serializeSignedInCookie, signedInCookieScopeFromEnv } from '@/lib/auth/signed-in-cookie'

const middleware = authkitMiddleware({
  debug: process.env.NODE_ENV === 'development',
  middlewareAuth: {
    enabled: isAuthRequired(),
    unauthenticatedPaths: [
      '/',
      '/api/healthz',
      '/api/health',
      '/api/auth/callback',
      '/api/auth/signin',
      '/api/auth/websocket-scope',
      '/auth/error',
      '/api/internal/(.*)',
      '/api/mcp',
      '/api/a2a',
      '/api/platform/mcp',
      '/api/webhooks/posthog-support',
      '/.well-known/(.*)',
      '/api/documents/(.*)/image',
    ],
  },
})

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = await middleware(request, event)
  if (!response) return response
  warnIfSessionIsDiscarded(request, response)
  const signedInCookie = signedInCookieFor(request, response)
  const answer = rerouteIncompleteSignIn(request, response)
  if (signedInCookie) answer.headers.append('set-cookie', signedInCookie)
  return answer
}

const SESSION_COOKIE_NAME = process.env.WORKOS_COOKIE_NAME || 'wos-session'

const SESSION_CHUNK_PREFIX = `${SESSION_COOKIE_NAME}.`

function isSessionCookie(name: string): boolean {
  if (name === SESSION_COOKIE_NAME) return true
  return name.startsWith(SESSION_CHUNK_PREFIX) && /^\d+$/.test(name.slice(SESSION_CHUNK_PREFIX.length))
}

function sessionCookies(request: NextRequest): { name: string; value: string }[] {
  return request.cookies.getAll().filter(({ name }) => isSessionCookie(name))
}

function warnIfSessionIsDiscarded(request: NextRequest, response: Response): void {
  if (!isAuthorizeRedirect(response.headers.get('location'))) return
  const cookies = sessionCookies(request)
  if (cookies.length === 0) return

  console.warn('[auth] session cookie present, but AuthKit is sending the request to sign in again', {
    path: request.nextUrl.pathname,
    cookieBytes: cookies.reduce((bytes, { value }) => bytes + value.length, 0),
    cookieChunks: cookies.length,
    redirectCarriesVerifier: carriesVerifierCookie(response),
    requestKind: request.headers.get('rsc') === '1' ? 'rsc' : request.headers.get('accept') ?? 'unknown',
  })
}

const SIGN_IN_PATH = '/api/auth/signin'
const AUTHORIZE_PATH_SUFFIX = '/user_management/authorize'
const VERIFIER_COOKIE_PREFIX = 'wos-auth-verifier'

function isAuthorizeRedirect(location: string | null): boolean {
  if (!location) return false
  try {
    return new URL(location).pathname.endsWith(AUTHORIZE_PATH_SUFFIX)
  } catch {
    return false
  }
}

function carriesVerifierCookie(response: Response): boolean {
  return response.headers.getSetCookie().some((cookie) => {
    const [pair] = cookie.split(';', 1)
    const separator = pair.indexOf('=')
    if (separator < 0) return false
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    const isVerifier = name === VERIFIER_COOKIE_PREFIX || name.startsWith(`${VERIFIER_COOKIE_PREFIX}-`)
    return isVerifier && value !== ''
  })
}

function isPrefetch(request: NextRequest): boolean {
  return (
    request.headers.get('purpose') === 'prefetch' ||
    (request.headers.get('sec-purpose') ?? '').includes('prefetch') ||
    request.headers.has('next-router-prefetch')
  )
}

function returnPathnameFor(request: NextRequest): string | null {
  const { pathname, searchParams } = request.nextUrl
  if (pathname.startsWith('/api/')) return null

  const params = new URLSearchParams(searchParams)
  params.delete('_rsc')
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

// Absolute on purpose: Next's middleware adapter threw "Invalid URL" on a relative Location and every rerouted request answered 500 (staging, 2026-11-04).
function publicOrigin(request: NextRequest): string {
  const configured = process.env.WORKOS_REDIRECT_URI ?? process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
  try {
    if (configured) return new URL(configured).origin
  } catch {
    // An unparseable setting falls back to the request, as with none.
  }
  return request.nextUrl.origin
}

function rerouteIncompleteSignIn(request: NextRequest, response: Response): Response {
  if (response.status < 300 || response.status >= 400) return response
  if (!isAuthorizeRedirect(response.headers.get('location'))) return response
  if (carriesVerifierCookie(response)) return response
  if (isPrefetch(request)) return response

  const returnPathname = returnPathnameFor(request)
  const query = returnPathname ? `?returnPathname=${encodeURIComponent(returnPathname)}` : ''

  const rerouted = new NextResponse(null, {
    status: request.method === 'GET' || request.method === 'HEAD' ? 307 : 303,
    headers: { location: `${publicOrigin(request)}${SIGN_IN_PATH}${query}` },
  })
  for (const cookie of response.headers.getSetCookie()) rerouted.headers.append('set-cookie', cookie)
  rerouted.headers.set('cache-control', 'no-store')
  return rerouted
}

function clearsSession(response: Response): boolean {
  let cleared = false
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';', 1)
    const separator = pair.indexOf('=')
    if (separator < 0 || !isSessionCookie(pair.slice(0, separator).trim())) continue
    if (pair.slice(separator + 1).trim() !== '') return false
    cleared = true
  }
  return cleared
}

function signedInCookieFor(request: NextRequest, response: Response): string | null {
  if (!isAuthRequired()) return null
  const scope = signedInCookieScopeFromEnv()
  if (!scope) return null

  const signedIn =
    sessionCookies(request).length > 0 &&
    !isAuthorizeRedirect(response.headers.get('location')) &&
    !clearsSession(response)
  const marked = request.cookies.get(SIGNED_IN_COOKIE_NAME)?.value === '1'
  return signedIn === marked ? null : serializeSignedInCookie(scope, signedIn)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico$|icon\\.svg$|apple-icon\\.png$|manifest\\.webmanifest$|robots\\.txt$|sw\\.js$|icons/|art/|public|api/healthz|ingest/|api/internal/signed/).*)',
  ],
}
