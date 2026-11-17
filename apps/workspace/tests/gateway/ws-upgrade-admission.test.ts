/**
 * @vitest-environment node
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { verifyRequestContextEnvelope } from '../../bff/request-context'

const UI_ROOT = path.resolve(__dirname, '../..')

let upstream: http.Server
let upstreamPort = 0
let scopeHits = 0
let slowScope = false
let resetAfterUpgrade = false
let scopeExtra: Record<string, unknown> = {}
let backendHeaders: http.IncomingHttpHeaders = {}
let anonymousScope = false
const SECRET = 'gateway-turn-context-test-token' // pragma: allowlist secret
const running: ChildProcess[] = []
const openSockets = new Set<import('node:stream').Duplex>()

function handleExpectedTeardown(error: NodeJS.ErrnoException): void {
  if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') throw error
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if ((req.url || '').startsWith('/api/auth/websocket-scope')) {
      scopeHits += 1
      const reply = () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            header: 'c2NvcGU',
            ...(!anonymousScope ? { organizationId: 'org_1', userId: 'user_1' } : {}),
            scope: ['col_a'],
            ...scopeExtra,
          })
        )
      }
      if (slowScope) setTimeout(reply, 400)
      else reply()
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  upstream.on('connection', (sock) => {
    openSockets.add(sock)
    sock.on('error', handleExpectedTeardown)
    sock.on('close', () => openSockets.delete(sock))
  })
  upstream.on('upgrade', (req, sock) => {
    backendHeaders = req.headers
    openSockets.add(sock)
    sock.on('close', () => openSockets.delete(sock))
    sock.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
    )
    if (resetAfterUpgrade) {
      setTimeout(() => (sock as import('node:net').Socket).resetAndDestroy(), 150)
    }
  })
  await new Promise<void>((resolve) => upstream.listen(0, resolve))
  upstreamPort = (upstream.address() as { port: number }).port
})

afterAll(async () => {
  for (const sock of openSockets) sock.destroy()
  openSockets.clear()
  await new Promise<void>((resolve) => upstream.close(() => resolve()))
})

afterEach(() => {
  while (running.length) running.pop()?.kill('SIGKILL')
  slowScope = false
  resetAfterUpgrade = false
  scopeExtra = {}
  backendHeaders = {}
  anonymousScope = false
})

async function reservePort(): Promise<number> {
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as { port: number }
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

let gatewayOutput = ''

async function startGateway(env: Record<string, string> = {}): Promise<number> {
  gatewayOutput = ''
  const port = await reservePort()
  const child = spawn('node', ['server.js'], {
    cwd: UI_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      NEXT_INTERNAL_URL: `http://127.0.0.1:${upstreamPort}`,
      BACKEND_CHAT_URL: `http://127.0.0.1:${upstreamPort}`,
      WS_UPGRADE_RATE_LIMIT: '0',
      INTERNAL_API_TOKEN: SECRET,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  running.push(child)
  child.stderr?.on('data', (chunk: Buffer) => {
    gatewayOutput += chunk.toString()
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway did not start')), 20_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      gatewayOutput += chunk.toString()
      if (chunk.toString().includes('Frontend:')) {
        clearTimeout(timer)
        setTimeout(resolve, 200)
      }
    })
  })
  return port
}

async function waitForLog(needle: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (gatewayOutput.includes(needle)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`gateway never logged ${JSON.stringify(needle)}; saw:\n${gatewayOutput}`)
}

function upgrade(port: number, cookie: string): Promise<number> {
  return new Promise((resolve) => {
    const req = http.request({
      port,
      path: '/websocket?conversationId=conv-1',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        Cookie: cookie,
      },
    })
    req.on('upgrade', (res, sock) => {
      sock.on('error', handleExpectedTeardown)
      sock.destroy()
      resolve(res.statusCode ?? 101)
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', () => resolve(0))
    req.setTimeout(5000, () => req.destroy())
    req.end()
  })
}

describe('gateway WS-upgrade scope memoisation', () => {
  it('collapses repeat upgrades for one session onto a single resolution', async () => {
    const port = await startGateway()
    scopeHits = 0

    for (let i = 0; i < 5; i += 1) await upgrade(port, 'session=alpha')

    expect(scopeHits).toBe(1)
  })

  it('keys the memo per session, not globally', async () => {
    const port = await startGateway()
    scopeHits = 0

    await upgrade(port, 'session=alpha')
    await upgrade(port, 'session=beta')

    expect(scopeHits).toBe(2)
  })

  it('pays per upgrade when the memo is disabled', async () => {
    const port = await startGateway({ WS_SCOPE_CACHE_TTL_MS: '0' })
    scopeHits = 0

    for (let i = 0; i < 5; i += 1) await upgrade(port, 'session=alpha')

    expect(scopeHits).toBe(5)
  })

  it('coalesces concurrent upgrades for one session (single-flight)', async () => {
    const port = await startGateway()
    slowScope = true
    scopeHits = 0

    await Promise.all(Array.from({ length: 10 }, () => upgrade(port, 'session=gamma')))

    expect(scopeHits).toBe(1)
  })
})

describe('gateway compact turn-context transport', () => {
  it('never forwards >6200-byte prompt blocks, even in the signed envelope', async () => {
    scopeExtra = {
      projectContext: 'ä'.repeat(4000),
      projectMemory: 'memory'.repeat(4000),
      orgInstructions: 'instructions'.repeat(4000),
      projectId: 'proj_1', conversationId: 's_text-conversation',
      federalState: 'vienna', memoryReflectionEnabled: true,
    }
    const port = await startGateway()
    expect(await upgrade(port, 'session=large-profile')).toBe(101)
    for (const name of ['x-project-context', 'x-project-memory', 'x-org-instructions']) {
      expect(backendHeaders).not.toHaveProperty(name)
    }
    const header = backendHeaders['x-request-context'] as string
    const payload = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
    expect(payload).toMatchObject({
      organizationId: 'org_1', userId: 'user_1', projectId: 'proj_1',
      conversationId: 's_text-conversation', contextTransport: 'bff', federalState: 'vienna',
      memoryReflectionEnabled: true,
    })
    for (const field of ['projectContext', 'projectMemory', 'orgInstructions']) {
      expect(payload).not.toHaveProperty(field)
    }
    expect(verifyRequestContextEnvelope(
      header, backendHeaders['x-request-context-sig'] as string, SECRET,
    )).toMatchObject({ organizationId: 'org_1', userId: 'user_1' })
    expect(Buffer.byteLength(header)).toBeLessThan(1000)
  })

  it('rejects an oversized remaining signed capsule with 431 before contacting the backend', async () => {
    scopeExtra = { modelOverrides: { chat: 'a'.repeat(7000) } }
    const port = await startGateway()
    expect(await upgrade(port, 'session=oversized-policy')).toBe(431)
    expect(backendHeaders).toEqual({})
    expect(gatewayOutput).toContain('Header exceeds upstream line budget')
    expect(gatewayOutput).not.toContain('a'.repeat(100))
  })

  it('fails closed for authenticated compact context when its service token is unavailable', async () => {
    const port = await startGateway({ INTERNAL_API_TOKEN: '' })
    expect(await upgrade(port, 'session=no-service-token')).toBe(503)
    expect(backendHeaders).toEqual({})
  })

  it('does not emit the BFF transport marker for anonymous upgrades', async () => {
    anonymousScope = true
    scopeExtra = {
      projectContext: 'legacy profile',
      projectMemory: 'legacy memory',
      orgInstructions: 'legacy instructions',
    }
    const port = await startGateway({ INTERNAL_API_TOKEN: '' })
    expect(await upgrade(port, 'session=anonymous')).toBe(101)
    const payload = JSON.parse(Buffer.from(backendHeaders['x-request-context'] as string, 'base64url').toString('utf8'))
    expect(payload).not.toHaveProperty('contextTransport')
    expect(payload.projectContext).toBe('legacy profile')
    expect(payload.projectMemory).toBe('legacy memory')
    expect(payload.orgInstructions).toBe('legacy instructions')
    expect(Buffer.from(backendHeaders['x-project-context'] as string, 'base64url').toString('utf8')).toBe('legacy profile')
    expect(Buffer.from(backendHeaders['x-project-memory'] as string, 'base64url').toString('utf8')).toBe('legacy memory')
    expect(Buffer.from(backendHeaders['x-org-instructions'] as string, 'base64url').toString('utf8')).toBe('legacy instructions')
  })
})

describe('gateway WS-upgrade admission gate', () => {
  it('sheds past the in-flight ceiling instead of queueing', async () => {
    const port = await startGateway({ WS_UPGRADE_MAX_INFLIGHT: '2' })
    slowScope = true
    scopeHits = 0

    const codes = await Promise.all(
      Array.from({ length: 12 }, (_, i) => upgrade(port, `session=load-${i}`))
    )

    expect(scopeHits).toBe(2)
    expect(codes.filter((c) => c === 503)).toHaveLength(10)
    expect(codes.filter((c) => c === 101)).toHaveLength(2)
  })

  it('still sheds when the memo is disabled', async () => {
    const port = await startGateway({
      WS_UPGRADE_MAX_INFLIGHT: '2',
      WS_SCOPE_CACHE_TTL_MS: '0',
    })
    slowScope = true
    scopeHits = 0

    const codes = await Promise.all(
      Array.from({ length: 12 }, (_, i) => upgrade(port, `session=nocache-${i}`))
    )

    expect(scopeHits).toBe(2)
    expect(codes.filter((c) => c === 503)).toHaveLength(10)
  })
})

describe('gateway chat backend address', () => {
  it('dials BACKEND_CHAT_URL for the socket and never BACKEND_URL, which is the api role', async () => {
    const deadPort = await reservePort() // nothing listens: the api role serves no socket
    const port = await startGateway({ BACKEND_URL: `http://127.0.0.1:${deadPort}` })

    expect(await upgrade(port, 'session=chat-role')).toBe(101)
  })

  it('refuses to start without BACKEND_CHAT_URL, whatever BACKEND_URL says', () => {
    const inherited = { ...process.env }
    delete inherited.BACKEND_CHAT_URL
    const result = spawnSync('node', ['server.js'], {
      cwd: UI_ROOT,
      env: { ...inherited, NODE_ENV: 'development', PORT: '0', BACKEND_URL: `http://127.0.0.1:${upstreamPort}` },
      encoding: 'utf8',
      timeout: 20_000,
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('BACKEND_CHAT_URL is required')
  })
})

describe('gateway WS-upgrade upstream failures', () => {
  it('reports an unreachable backend as a warning, not an error', async () => {
    const deadPort = await reservePort() // reserved, then released — nothing listens
    const port = await startGateway({ BACKEND_CHAT_URL: `http://127.0.0.1:${deadPort}` })

    expect(await upgrade(port, 'session=dead-backend')).toBe(502)

    await waitForLog('[WS Proxy] Backend unreachable')
    expect(gatewayOutput).toContain('ECONNREFUSED')
    expect(gatewayOutput).not.toContain('[WS Proxy] Error:')
  })

  it('treats a reset after the upgrade as teardown and never writes a 502 into the socket', async () => {
    resetAfterUpgrade = true
    const port = await startGateway()

    const received = await new Promise<string>((resolve) => {
      const req = http.request({
        port,
        path: '/websocket?conversationId=conv-1',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          Cookie: 'session=reset',
        },
      })
      req.on('upgrade', (_res, sock) => {
        let bytes = ''
        sock.on('data', (chunk: Buffer) => (bytes += chunk.toString('latin1')))
        sock.on('error', () => {})
        sock.on('close', () => resolve(bytes))
      })
      req.on('error', () => resolve('request failed'))
      req.end()
    })

    expect(received).not.toContain('502')
    await waitForLog('[WebSocket] closed by upstream')
    expect(gatewayOutput).toMatch(/\[WebSocket\] upstream socket ECONNRESET after \d+\.\ds/)
    expect(gatewayOutput).not.toContain('upstream socket error')
    expect(gatewayOutput).not.toContain('[WS Proxy] Error:')
    expect(gatewayOutput).not.toContain('rejecting upgrade')
  })
})
