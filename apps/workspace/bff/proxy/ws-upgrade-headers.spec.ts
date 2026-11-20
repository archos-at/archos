/**
 * @vitest-environment node
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http'
import { createServer as createProbeServer, type AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findOversizedWsHeader, stripClientContextHeaders, withoutSessionCookies, WS_HEADER_LINE_MAX_BYTES } from './ws-upgrade-headers.js'
import { TURN_DOOR_HEADER, TURN_SESSION_SOURCE_HEADER } from '../turns/headless-mode'

const CONTEXT_HEADER_PREFIX = 'x-grid-'
const ctx = (name: string) => `${CONTEXT_HEADER_PREFIX}${name}`
const INTERNAL_TOKEN = 'internal-test-token'

describe('stripClientContextHeaders', () => {
  it('removes every context header a client sent', () => {
    const headers: Record<string, string> = {
      [ctx('model-overrides')]: 'eyJkZWVwX3Jlc2VhcmNoIjoieC9ncm9rIn0', // pragma: allowlist secret (base64 JSON fixture, not a credential)
      [ctx('budget')]: 'eyJyZW1haW5pbmdPcmdVc2QiOjk5OTk5fQ',
      [ctx('disabled-sources')]: 'W10',
      [ctx('request-context')]: 'forged',
      [ctx('request-context-sig')]: 'forged',
      [ctx('internal-token')]: 'guess',
      [ctx('some-future-field')]: 'x',
    }

    const removed = stripClientContextHeaders(headers)

    expect(headers).toEqual({})
    expect(removed).toHaveLength(7)
  })

  it('removes the same headers under their names without the product name', () => {
    const headers: Record<string, string> = {
      'x-model-overrides': 'forged',
      'x-budget': 'forged',
      'x-disabled-sources': 'forged',
      'x-organization-id': 'org_someone_else',
      'x-request-context': 'forged',
      'x-request-context-sig': 'forged',
    }

    expect(stripClientContextHeaders(headers)).toHaveLength(6)
    expect(headers).toEqual({})
  })

  it('removes a client bearer and the service-token header', () => {
    const headers: Record<string, string> = {
      authorization: 'Bearer someone-elses-token',
      'x-internal-token': 'guess',
    }

    stripClientContextHeaders(headers)

    expect(headers).toEqual({})
  })

  it('removes the agent door a headless ask names, so a browser turn cannot claim one', () => {
    const headers: Record<string, string> = { [TURN_DOOR_HEADER]: 'mcp', [TURN_SESSION_SOURCE_HEADER]: 'mcp' }

    stripClientContextHeaders(headers)

    expect(headers).toEqual({})
  })

  it('keeps what the proxy and the backend need from the client', () => {
    const headers: Record<string, string> = {
      cookie: 'wos-session=abc',
      host: 'app.example',
      origin: 'https://app.example',
      'sec-websocket-key': 'k',
      'sec-websocket-version': '13',
      'x-forwarded-for': '203.0.113.7',
      'x-gridlock': 'y',
    }
    const before = { ...headers }

    expect(stripClientContextHeaders(headers)).toEqual([])
    expect(headers).toEqual(before)
  })
})

describe('WebSocket per-header encoded line budget', () => {
  it('counts the header name, separators and CRLF', () => {
    const value = 'a'.repeat(WS_HEADER_LINE_MAX_BYTES - Buffer.byteLength('x: \r\n'))
    expect(findOversizedWsHeader({ x: value })).toBeNull()
    expect(findOversizedWsHeader({ x: value + 'a' })).toEqual({ name: 'x', bytes: 8193 })
  })

  it('counts UTF-8 bytes and encoded bytes rather than characters', () => {
    expect(findOversizedWsHeader({ x: 'ä'.repeat(4100) })?.bytes).toBe(8205)
    const profile = 'ä'.repeat(3101)
    expect(Buffer.byteLength(profile)).toBeGreaterThan(6200)
    expect(findOversizedWsHeader({
      [ctx('project-context')]: Buffer.from(profile).toString('base64url'),
    })?.name).toBe(ctx('project-context'))
  })

  it('checks each array header line and the combined cookie line', () => {
    expect(findOversizedWsHeader({ x: ['a'.repeat(5000), 'b'.repeat(5000)] })).toBeNull()
    expect(findOversizedWsHeader({ cookie: ['a'.repeat(5000), 'b'.repeat(5000)] })?.name).toBe('cookie')
  })
})

function listenOnFreePort(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createProbeServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

const backendHeaders: IncomingHttpHeaders[] = []

function fakeBackend(): Server {
  const server = createServer()
  server.on('upgrade', (req, socket) => {
    backendHeaders.push(req.headers)
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  })
  return server
}

function fakeNext(): Server {
  return createServer((req, res) => {
    if (req.url?.startsWith('/api/auth/websocket-scope')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ header: 'scope-header', organizationId: 'org-1', userId: 'user-1' }))
      return
    }
    res.writeHead(404).end()
  })
}

function startGateway(env: Record<string, string>): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    let output = ''
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../server.js', import.meta.url))], {
      env: { ...process.env, ...env },
      stdio: 'pipe',
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk
      if (output.includes('[boot]')) resolve(child)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk
    })
    child.once('exit', (code) => reject(new Error(`gateway exited with ${code}: ${output}`)))
  })
}

function openSocket(gatewayPort: number, headers: Record<string, string>): Promise<IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: gatewayPort,
      path: '/websocket?projectId=project-1&conversationId=conversation-1',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    })
    req.on('upgrade', (_response, socket) => {
      socket.destroy()
      resolve(backendHeaders.at(-1) ?? {})
    })
    req.on('response', (response) => reject(new Error(`upgrade refused with ${response.statusCode}`)))
    req.on('error', reject)
    req.end()
  })
}

describe('the gateway strips client headers before it writes its own', () => {
  let gateway: ChildProcess | undefined
  let gatewayPort = 0
  let backend: Server | undefined
  let next: Server | undefined

  beforeAll(async () => {
    backend = fakeBackend()
    const backendPort = await listenOnFreePort(backend)
    next = fakeNext()
    const nextPort = await listenOnFreePort(next)
    gatewayPort = await freePort()
    gateway = await startGateway({
      NODE_ENV: 'development',
      HOSTNAME: '127.0.0.1',
      PORT: String(gatewayPort),
      BACKEND_CHAT_URL: `http://127.0.0.1:${backendPort}`,
      NEXT_INTERNAL_URL: `http://127.0.0.1:${nextPort}`,
      INTERNAL_API_TOKEN: INTERNAL_TOKEN,
      REDIS_URL: '',
      WORKOS_COOKIE_NAME: 'wos-session',
      WS_UPGRADE_RATE_LIMIT: '0',
      WS_MESSAGE_LIMITS: '0',
      WS_SCOPE_CACHE_TTL_MS: '0',
    })
  }, 30_000)

  afterAll(() => {
    gateway?.kill('SIGKILL')
    backend?.close()
    next?.close()
  })

  it('keeps every client context header from the backend and sends the scope the BFF resolved', async () => {
    const received = await openSocket(gatewayPort, {
      [ctx('model-overrides')]: 'forged',
      [ctx('budget')]: 'forged',
      [ctx('disabled-sources')]: 'forged',
      'x-budget': 'forged',
      'x-organization-id': 'org_someone_else',
      authorization: 'Bearer someone-elses-token',
      'x-internal-token': 'guess',
      [TURN_DOOR_HEADER]: 'mcp',
      [TURN_SESSION_SOURCE_HEADER]: 'mcp',
    })

    for (const name of [
      ctx('model-overrides'),
      ctx('budget'),
      ctx('disabled-sources'),
      'x-budget',
      'authorization',
      'x-internal-token',
      TURN_DOOR_HEADER,
      TURN_SESSION_SOURCE_HEADER,
    ]) {
      expect(received[name], name).toBeUndefined()
    }
    expect(received['x-organization-id']).toBe('org-1')

    const json = Buffer.from(String(received['x-request-context']), 'base64url').toString('utf8')
    expect(JSON.parse(json)).toMatchObject({ organizationId: 'org-1', userId: 'user-1' })
    expect(received['x-request-context-sig']).toBe(createHmac('sha256', INTERNAL_TOKEN).update(json, 'utf8').digest('hex'))
  })

  it('sends the backend the cookies without the AuthKit session', async () => {
    const received = await openSocket(gatewayPort, {
      cookie: 'wos-session.0=a; idToken=t; wos-session.1=b; wos-session=z; ph_x=1',
    })

    expect(received.cookie).toBe('idToken=t; ph_x=1')
  })
})

describe('withoutSessionCookies', () => {
  it('drops the AuthKit session, whole or in chunks, and keeps every other cookie', () => {
    expect(withoutSessionCookies('wos-session.0=a; idToken=t; wos-session.1=b; wos-session=z; ph_x=1')).toBe(
      'idToken=t; ph_x=1',
    )
  })

  it('keeps a cookie that only starts with the session name', () => {
    expect(withoutSessionCookies('wos-session-other=1; wos-session.x=2')).toBe('wos-session-other=1; wos-session.x=2')
  })

  it('sends no Cookie line when the session was all there was', () => {
    expect(withoutSessionCookies('wos-session.0=a; wos-session.1=b')).toBeUndefined()
    expect(withoutSessionCookies(undefined)).toBeUndefined()
  })

  it('keeps a chat socket under the line limit however large the session grows', () => {
    const chunks = Array.from({ length: 4 }, (_, index) => `wos-session.${index}=${'s'.repeat(3800)}`).join('; ')
    const cookie = withoutSessionCookies(`${chunks}; idToken=t`)

    expect(findOversizedWsHeader({ cookie })).toBeNull()
  })
})
