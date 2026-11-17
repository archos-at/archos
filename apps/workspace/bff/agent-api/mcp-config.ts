import { type OAuthMetadata, buildOAuthProtectedResourceMetadata } from '@modelcontextprotocol/server'
import { configuredAppOrigin } from '@/lib/app-origin'
import { PRODUCT_NAME } from '@/lib/brand'

export const MCP_PATH = '/api/mcp'
export const A2A_PATH = '/api/a2a'
export const PLATFORM_MCP_PATH = '/api/platform/mcp'

export type DoorResource = 'mcp' | 'a2a' | 'platform'

const AUDIENCE_GROUPS: Readonly<Record<DoorResource, readonly DoorResource[]>> = {
  mcp: ['mcp', 'a2a'],
  a2a: ['mcp', 'a2a'],
  platform: ['platform'],
}

export const MCP_SCOPES_SUPPORTED = ['openid', 'profile', 'email', 'offline_access'] as const

type Env = Record<string, string | undefined>

export function authkitDomain(env: Env = process.env): string | null {
  const raw = env.WORKOS_AUTHKIT_DOMAIN?.trim()
  if (!raw) return null
  const bare = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return bare || null
}

export function authkitIssuer(env: Env = process.env): string | null {
  const domain = authkitDomain(env)
  return domain ? `https://${domain}` : null
}

export function mcpResourceUrl(env: Env = process.env): URL | null {
  const configured = env.MCP_RESOURCE_URL?.trim()
  try {
    if (configured) return new URL(configured)
    const origin = configuredAppOrigin(env)
    return origin ? new URL(MCP_PATH, origin) : null
  } catch {
    return null
  }
}

export function formerOrigins(env: Env = process.env): string[] {
  const canonical = mcpResourceUrl(env)?.origin
  const origins = (env.MCP_FORMER_ORIGINS ?? '').split(',').flatMap((raw) => {
    try {
      const url = new URL(raw.trim())
      return url.protocol === 'https:' || url.protocol === 'http:' ? [url.origin] : []
    } catch {
      return []
    }
  })
  return [...new Set(origins)].filter((origin) => origin !== canonical)
}

export function requestHost(request: Request): string | null {
  const raw = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const host = raw?.split(',')[0]?.trim().toLowerCase()
  if (!host) return null
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return null
  }
}

function asSeenFrom(canonical: URL, host: string | null | undefined, env: Env): URL {
  if (!host) return canonical
  const former = formerOrigins(env).find((origin) => new URL(origin).hostname === host)
  return former ? new URL(canonical.pathname, former) : canonical
}

export function a2aResourceUrl(env: Env = process.env): URL | null {
  const mcp = mcpResourceUrl(env)
  return mcp ? new URL(A2A_PATH, mcp.origin) : null
}

export function platformMcpResourceUrl(env: Env = process.env): URL | null {
  const mcp = mcpResourceUrl(env)
  return mcp ? new URL(PLATFORM_MCP_PATH, mcp.origin) : null
}

function canonicalResourceUrl(door: DoorResource, env: Env): URL | null {
  if (door === 'platform') return platformMcpResourceUrl(env)
  return door === 'a2a' ? a2aResourceUrl(env) : mcpResourceUrl(env)
}

export function doorResourceUrl(door: DoorResource, env: Env = process.env, host?: string | null): URL | null {
  const canonical = canonicalResourceUrl(door, env)
  return canonical ? asSeenFrom(canonical, host, env) : null
}

function doorResourceUrls(door: DoorResource, env: Env): URL[] {
  const canonical = canonicalResourceUrl(door, env)
  if (!canonical) return []
  return [canonical, ...formerOrigins(env).map((origin) => new URL(canonical.pathname, origin))]
}

const underPath = (pathname: string, path: string): boolean => pathname === path || pathname.startsWith(`${path}/`)

export function doorOf(request: Request): DoorResource {
  const { pathname } = new URL(request.url)
  if (underPath(pathname, PLATFORM_MCP_PATH)) return 'platform'
  return underPath(pathname, A2A_PATH) ? 'a2a' : 'mcp'
}

export function acceptedAudiences(door: DoorResource = 'mcp', env: Env = process.env): string[] {
  const resources = AUDIENCE_GROUPS[door].flatMap((member) => doorResourceUrls(member, env))
  return [
    ...new Set(
      resources.flatMap((url) => {
        const bare = url.href.replace(/\/+$/, '')
        return [bare, `${bare}/`]
      }),
    ),
  ]
}

export function allowedOriginHostnames(env: Env = process.env): string[] {
  const hosts = new Set<string>()
  const origin = configuredAppOrigin(env)
  if (origin) hosts.add(new URL(origin).hostname)
  const resource = mcpResourceUrl(env)
  if (resource) hosts.add(resource.hostname)
  for (const origin of formerOrigins(env)) hosts.add(new URL(origin).hostname)
  if (hosts.size === 0) return ['localhost', '127.0.0.1', '[::1]']
  return [...hosts]
}

const RESOURCE_NAMES: Readonly<Record<DoorResource, string>> = {
  mcp: PRODUCT_NAME,
  a2a: PRODUCT_NAME,
  platform: `${PRODUCT_NAME} platform console`,
}

export function protectedResourceMetadata(env: Env = process.env, door: DoorResource = 'mcp', host?: string | null) {
  const issuer = authkitIssuer(env)
  const resource = doorResourceUrl(door, env, host)
  if (!issuer || !resource) return null
  const oauthMetadata: OAuthMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    token_endpoint: `${issuer}/oauth2/token`,
    registration_endpoint: `${issuer}/oauth2/register`,
    response_types_supported: ['code'],
  }
  return {
    ...buildOAuthProtectedResourceMetadata({
      oauthMetadata,
      resourceServerUrl: resource,
      scopesSupported: [...MCP_SCOPES_SUPPORTED],
      resourceName: RESOURCE_NAMES[door],
    }),
    bearer_methods_supported: ['header'],
  }
}

export function protectedResourceMetadataResponse(door: DoorResource = 'mcp', request?: Request): Response {
  const metadata = protectedResourceMetadata(process.env, door, request ? requestHost(request) : null)
  if (!metadata) {
    return Response.json(
      { error: 'The agent door is not configured on this deployment (WORKOS_AUTHKIT_DOMAIN)' },
      { status: 503 },
    )
  }
  return Response.json(metadata, {
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300',
    },
  })
}
