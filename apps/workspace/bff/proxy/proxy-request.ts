import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import type { UserSession } from '@/lib/auth/types'
import { getBackendUrl, isAuthRequired } from '@/lib/backend-proxy'

export function buildProxyUrl(
  basePath: string,
  path: string[],
  searchParams?: URLSearchParams,
  omitParams: string[] = []
): string {
  const url = new URL(`${getBackendUrl()}${basePath}/${path.join('/')}`)
  searchParams?.forEach((value, key) => {
    if (!omitParams.includes(key)) {
      url.searchParams.set(key, value)
    }
  })
  return url.toString()
}

export async function resolveSessionAndBearer(
  req: Request,
  pathSegments: string[],
  label: string
): Promise<{ session: UserSession | null; authHeader: string | null }> {
  if (!isAuthRequired()) {
    return { session: null, authHeader: null }
  }

  const session = await requireAuthorizedSession()

  const allowQueryToken = pathSegments.includes('stream')
  const rawQueryToken = new URL(req.url).searchParams.get('token')?.trim()
  const queryToken = allowQueryToken && rawQueryToken ? rawQueryToken : undefined

  const headerToken =
    req.headers.get('Authorization') || (queryToken ? `Bearer ${queryToken}` : null)
  const authHeader = headerToken || (session.accessToken ? `Bearer ${session.accessToken}` : null)

  if (queryToken && !authHeader) {
    console.warn(
      `[${label}] SSE stream using ?token= query fallback (WorkOS session cookie missing)`
    )
  }

  return { session, authHeader }
}
