// @disk-inputs: app/api/**
/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const API_DIR = dirname(fileURLToPath(import.meta.url))

function findRouteFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findRouteFiles(path))
    else if (entry.name === 'route.ts') found.push(path)
  }
  return found
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

const HAND_ROLLED: Record<string, string> = {
  'v1/[...path]/route.ts':
    'transport pass-through to the backend: resolves the session, forwards only the method and path shapes in lib/proxy/v1-allowlist (404 for the rest), and validates the collection scope per method via lib/proxy/collection-authz. Returns upstream responses verbatim, so it cannot use the factory’s JSON serialization.',
  'jobs/async/[...path]/route.ts':
    'async-job proxy: streams upstream responses and forwards the WorkOS access token. The BFF decides and the backend enforces (ADR-0084): on every method `buildCollectionScopeFromRequest` checks CHAT_PERMISSIONS on the named project and `viewer` on the named conversation, and `signJobRequestContext` signs what passed; agent_host/jobs/access.py then lets the job’s owner through, and anyone else only to a job inside that project (read and steer) or conversation (read), in the same organization. The one write it performs — filing a finished report as a document — is gated separately and in the BFF: `fileGeneratedDocument` requires `project:documents:write` AND `project:documents:generate` on the project, plus the agent-authored-documents flag, before any byte is stored (lib/documents/generated.ts).',
  'a2a/route.ts':
    'the A2A door (ADR-0124): authenticates itself exactly as mcp/route.ts does, through resolvePrincipal (a WorkOS AuthKit bearer token for the agent door’s audience, the agent-mcp flag, the live membership), refuses the agent’s own credential, and speaks JSON-RPC and server-sent events through the A2A SDK, so it cannot use the cookie-session factory. Every method calls the piloti-ask routes through the dispatcher as that person, whose authz, rate limit and piloti-ask flag still decide.',
  'mcp/route.ts':
    'the agent door (ADR-0122): authenticates itself, a WorkOS AuthKit bearer token verified against the JWKS with issuer and this server’s audience (organization flag agent-mcp, live membership via resolvePinnedRequesterSession) or the internal token plus the signed request-context envelope for the agent. Answers with the MCP SDK’s response and a WWW-Authenticate challenge, so it cannot use the cookie-session factory; every operation then runs the browser’s own route handler as that person, whose authz still decides.',
  'platform/mcp/route.ts':
    'the platform door (ADR-0126): the same MCP edge as mcp/route.ts (mcpDoorPost), authenticated by a WorkOS AuthKit bearer token for the platform door’s own audience, issued in the platform organization (flag platform-agent-mcp), for a person isPlatformStaff accepts; the agent’s credential is refused. Every operation runs its platformApiRoute handler as that person, whose platform:* permission still decides.',
  'auth/websocket-scope/route.ts':
    'mints the WebSocket scope headers; gates with requireProjectAccess per project id before emitting any scope, and returns a bespoke header envelope rather than JSON.',
  'auth/callback/route.ts':
    'the AuthKit OAuth callback. It runs BEFORE a session exists — that is what it creates — so no session-based posture can apply.',
  'auth/signin/route.ts':
    'the sign-in entry point behind /?sign-in (the landing site’s Anmelden target). It runs BEFORE a session exists — it mints the AuthKit authorization redirect and its PKCE cookie, which only a Route Handler may write — so no session-based posture can apply.',
}

interface RouteFacts {
  file: string
  method: string
  factory: string | null
  declaresAuthz: boolean
}

function collectRoutes(): RouteFacts[] {
  const files = findRouteFiles(API_DIR)
  const facts: RouteFacts[] = []
  for (const absolute of files) {
    const file = relative(API_DIR, absolute).replace(/\\/g, '/')
    const source = readFileSync(absolute, 'utf8')
    for (const method of HTTP_METHODS) {
      const viaConst = new RegExp(`export const ${method}\\s*=`).test(source)
      const viaFunction = new RegExp(`export async function ${method}\\s*\\(`).test(source)
      if (!viaConst && !viaFunction) continue
      const viaFactory = new RegExp(
        `export const ${method}\\s*=\\s*(apiRoute|platformApiRoute|internalApiRoute|publicApiRoute)`
      ).exec(source)

      const start =
        source.indexOf(`export const ${method}`) >= 0
          ? source.indexOf(`export const ${method}`)
          : source.indexOf(`export async function ${method}`)
      const rest = source.slice(start + 1)
      const nextExport = rest.search(/\nexport (const [A-Z]+|async function [A-Z]+)/)
      const segment = nextExport >= 0 ? rest.slice(0, nextExport) : rest

      facts.push({
        file,
        method,
        factory: viaFactory?.[1] ?? null,
        declaresAuthz: /\bauthz:\s*\{/.test(segment) || /\bwhy:\s*['"]/.test(segment),
      })
    }
  }
  return facts
}

const ROUTES = collectRoutes()

describe('API authorization coverage', () => {
  it('finds the route surface (guards against a broken glob silently passing)', () => {
    expect(ROUTES.length).toBeGreaterThan(100)
  })

  it('every exported handler comes from a factory or is a recorded exception', () => {
    const undeclared = ROUTES.filter(
      (route) => route.factory === null && !(route.file in HAND_ROLLED)
    ).map((route) => `${route.file} [${route.method}]`)

    expect(
      undeclared,
      'Route handlers must be declared through apiRoute / platformApiRoute / ' +
        'internalApiRoute / publicApiRoute. If one genuinely cannot be, add it to ' +
        'HAND_ROLLED in this file with the gate it applies.'
    ).toEqual([])
  })

  it('every apiRoute and publicApiRoute states its authorization posture', () => {
    const silent = ROUTES.filter(
      (route) =>
        (route.factory === 'apiRoute' || route.factory === 'publicApiRoute') && !route.declaresAuthz
    ).map((route) => `${route.file} [${route.method}]`)

    expect(silent).toEqual([])
  })

  it('the hand-rolled exception list does not grow', () => {
    const handRolled = new Set(
      ROUTES.filter((route) => route.factory === null).map((route) => route.file)
    )
    expect([...handRolled].sort()).toEqual(Object.keys(HAND_ROLLED).sort())
  })

  it('every recorded exception explains the gate it applies', () => {
    for (const [file, reason] of Object.entries(HAND_ROLLED)) {
      expect(reason.length, `${file} needs a real reason, not a placeholder`).toBeGreaterThan(60)
    }
  })

  it('platform routes go through platformApiRoute, never a bare session read', () => {
    const offenders = ROUTES.filter(
      (route) =>
        route.file.startsWith('platform/') &&
        route.factory !== null &&
        route.factory !== 'platformApiRoute' &&
        !route.file.startsWith('platform/answer-feedback/')
    ).map((route) => `${route.file} [${route.method}] uses ${route.factory}`)

    expect(offenders).toEqual([])
  })
})
