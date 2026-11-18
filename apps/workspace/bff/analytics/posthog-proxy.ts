import { posthogAssetHost, POSTHOG_PROXY_PATH, type PostHogConfig } from './posthog-config'

const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'accept-language',
  'user-agent',
  'x-conversations-token',
] as const

const RETURNED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'] as const

const ASSET_PATH = /^\/(?:static|array)(?:\/|$)/

const UPSTREAM_TIMEOUT_MS = 30_000

export const buildUpstreamUrl = (requestUrl: string, host: string): string | null => {
  const incoming = new URL(requestUrl)
  if (incoming.pathname !== POSTHOG_PROXY_PATH && !incoming.pathname.startsWith(`${POSTHOG_PROXY_PATH}/`)) {
    return null
  }
  const rest = incoming.pathname.slice(POSTHOG_PROXY_PATH.length) || '/'
  const base = (ASSET_PATH.test(rest) ? posthogAssetHost(host) : host).replace(/\/+$/, '')
  const candidate = `${base}${rest}${incoming.search}`
  try {
    return new URL(candidate).origin === new URL(base).origin ? candidate : null
  } catch {
    return null
  }
}

const forwardedHeaders = (request: Request): Headers => {
  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip')
  if (clientIp) headers.set('x-forwarded-for', clientIp)
  return headers
}

const returnedHeaders = (upstream: Response): Headers => {
  const headers = new Headers()
  for (const name of RETURNED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

export const forwardToPosthog = async (
  request: Request,
  config: PostHogConfig,
  fetchImpl: typeof fetch = fetch
): Promise<Response> => {
  if (!config.proxy || !config.host || !config.projectToken) return new Response(null, { status: 404 })
  const upstreamUrl = buildUpstreamUrl(request.url, config.host)
  if (!upstreamUrl) return new Response(null, { status: 404 })

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  try {
    const upstream = await fetchImpl(upstreamUrl, {
      method: request.method,
      headers: forwardedHeaders(request),
      body: hasBody ? request.body : undefined,
      ...(hasBody ? { duplex: 'half' } : {}),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    } as RequestInit)
    return new Response(upstream.body, { status: upstream.status, headers: returnedHeaders(upstream) })
  } catch {
    return new Response(null, { status: 502 })
  }
}
