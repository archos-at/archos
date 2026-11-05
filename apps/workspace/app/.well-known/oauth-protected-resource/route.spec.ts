/**
 * @vitest-environment node
 */
/**
 * The RFC 9728 document an MCP client reads to find the authorization server
 * (ADR-0122). Both well-known paths serve the same document: the bare one and
 * the path-inserted one the 401 challenge points at.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { GET as a2a } from './api/a2a/route'
import { GET as pathInserted } from './api/mcp/route'
import { GET as platform } from './api/platform/mcp/route'
import { GET } from './route'
import { PRODUCT_NAME } from '@/lib/brand'

const CANONICAL = 'https://app.piloti.test/api/mcp'

const CURRENT_HOST = new URL(CANONICAL).host

/** A GET for the metadata as Envoy forwards it: the client's host in `Host`. */
const at = (host = CURRENT_HOST) => new Request('http://10.0.0.7:3000/.well-known/oauth-protected-resource', { headers: { host } })

beforeEach(() => {
  delete process.env.MCP_FORMER_ORIGINS
  process.env.WORKOS_AUTHKIT_DOMAIN = 'auth.piloti.test'
  process.env.MCP_RESOURCE_URL = CANONICAL
})

describe('oauth-protected-resource', () => {
  for (const [name, handler] of [['bare', GET], ['path-inserted', pathInserted]] as const) {
    it(`serves the metadata at the ${name} path`, async () => {
      const response = handler(at())
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(await response.json()).toEqual({
        resource: 'https://app.piloti.test/api/mcp',
        authorization_servers: ['https://auth.piloti.test'],
        scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
        resource_name: PRODUCT_NAME,
        bearer_methods_supported: ['header'],
      })
    })
  }

  it('serves the A2A door its own document, naming its own resource (ADR-0124)', async () => {
    const response = a2a(at())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      resource: 'https://app.piloti.test/api/a2a',
      authorization_servers: ['https://auth.piloti.test'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      resource_name: PRODUCT_NAME,
      bearer_methods_supported: ['header'],
    })
  })

  it('serves the platform door its own document, naming its own resource (ADR-0126)', async () => {
    const response = platform(at())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      resource: 'https://app.piloti.test/api/platform/mcp',
      authorization_servers: ['https://auth.piloti.test'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      resource_name: `${PRODUCT_NAME} platform console`,
      bearer_methods_supported: ['header'],
    })
  })

  it('derives the platform door from the same setting, so one change moves all three resources', async () => {
    process.env.MCP_RESOURCE_URL = 'https://piloti.example/api/mcp'
    const body = (await platform(at()).json()) as { resource: string }
    expect(body.resource).toBe('https://piloti.example/api/platform/mcp')
  })

  it('takes the resource from the pinned app origin when none is set', async () => {
    delete process.env.MCP_RESOURCE_URL
    process.env.WORKOS_REDIRECT_URI = 'https://app.piloti.test/api/auth/callback'
    const body = (await GET(at()).json()) as { resource: string }
    expect(body.resource).toBe('https://app.piloti.test/api/mcp')
  })

  it('answers 503 while AuthKit is not configured', () => {
    delete process.env.WORKOS_AUTHKIT_DOMAIN
    expect(GET(at()).status).toBe(503)
  })

  describe('after a domain move (MCP_FORMER_ORIGINS)', () => {
    beforeEach(() => {
      process.env.MCP_FORMER_ORIGINS = 'https://app.old.test'
    })

    it('names the former host’s resource to a client that asked there (RFC 9728 section 3.3)', async () => {
      for (const [handler, path] of [[pathInserted, '/api/mcp'], [a2a, '/api/a2a'], [platform, '/api/platform/mcp']] as const) {
        const body = (await handler(at('app.old.test')).json()) as { resource: string; authorization_servers: string[] }
        expect(body.resource).toBe(`https://app.old.test${path}`)
        expect(body.authorization_servers).toEqual(['https://auth.piloti.test'])
      }
    })

    it('keeps naming the canonical resource on the current host, and on any host it does not know', async () => {
      for (const host of [CURRENT_HOST, `${CURRENT_HOST}:443`, 'evil.example']) {
        const body = (await pathInserted(at(host)).json()) as { resource: string }
        expect(body.resource, host).toBe(CANONICAL)
      }
    })

    it('matches the former host with a port or in capitals', async () => {
      const body = (await pathInserted(at('APP.old.test:443')).json()) as { resource: string }
      expect(body.resource).toBe('https://app.old.test/api/mcp')
    })
  })
})
