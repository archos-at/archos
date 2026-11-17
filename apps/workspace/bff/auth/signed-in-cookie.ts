export const SIGNED_IN_COOKIE_NAME = 'signed_in'

const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 400

export interface SignedInCookieScope {
  domain: string | undefined
  secure: boolean
  maxAgeSeconds: number
}

interface ScopeSettings {
  redirectUri: string | undefined
  landingUrl: string | undefined
  sessionMaxAge: string | undefined
}

const hostOf = (url: string | undefined): URL | null => {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

export function signedInCookieScope(settings: ScopeSettings): SignedInCookieScope | null {
  const app = hostOf(settings.redirectUri)
  const site = hostOf(settings.landingUrl)
  if (!app || !site) return null

  const sameHost = app.hostname === site.hostname
  if (!sameHost && !app.hostname.endsWith(`.${site.hostname}`)) return null

  const parsedMaxAge = Number.parseInt(settings.sessionMaxAge ?? '', 10)
  return {
    domain: sameHost ? undefined : site.hostname,
    secure: app.protocol === 'https:',
    maxAgeSeconds: Number.isFinite(parsedMaxAge) && parsedMaxAge > 0 ? parsedMaxAge : DEFAULT_MAX_AGE_SECONDS,
  }
}

export function signedInCookieScopeFromEnv(): SignedInCookieScope | null {
  return signedInCookieScope({
    redirectUri: process.env.WORKOS_REDIRECT_URI ?? process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
    landingUrl: process.env.LANDING_URL,
    sessionMaxAge: process.env.WORKOS_COOKIE_MAX_AGE,
  })
}

export function serializeSignedInCookie(scope: SignedInCookieScope, signedIn: boolean): string {
  const parts = [
    `${SIGNED_IN_COOKIE_NAME}=${signedIn ? '1' : ''}`,
    'Path=/',
    `Max-Age=${signedIn ? scope.maxAgeSeconds : 0}`,
    'SameSite=Lax',
  ]
  if (!signedIn) parts.push(`Expires=${new Date(0).toUTCString()}`)
  if (scope.domain) parts.push(`Domain=${scope.domain}`)
  if (scope.secure) parts.push('Secure')
  return parts.join('; ')
}
