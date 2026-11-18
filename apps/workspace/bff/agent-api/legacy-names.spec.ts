/**
 * @vitest-environment node
 */
// The MCP surface's retired names, still served for one release: drop after release 2026-W50.
import { webcrypto } from 'node:crypto'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventTransport } from '@/lib/events/bus'
import { __setHubTransportForTests } from '@/lib/realtime/hub'
import * as discovery from './discovery'
import { canonicalRequest, canonicalUri, LEGACY_SENSITIVE_SCOPE } from './legacy-names'
import { createAgentDoorHandler } from './mcp-server'
import { PROPOSAL_CARD_URI } from './catalog/app-views'
import { GUIDE_URI } from './door'
import { maySeeSensitive } from './policy'
import type { AgentPrincipal } from './principal'

const VIEW_HTML = '<!doctype html><html><head></head><body><div id="root"></div></body></html>'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(async (path: unknown, ...rest: unknown[]) =>
      String(path).endsWith('mcp-app-views/proposal-card.html') ? VIEW_HTML : (actual.readFile as (...args: unknown[]) => unknown)(path, ...rest),
    ),
  }
})

const RETIRED_GUIDE = 'piloti://guide'
const RETIRED_PROJECT = 'piloti://project/p-1'
const RETIRED_VIEW = 'ui://piloti/proposal-card'

const session = {
  userId: 'user_1',
  email: 'a@example.test',
  name: null,
  accessToken: '',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  role: 'admin' as const,
  permissions: [],
  featureFlags: null,
}
const outside: AgentPrincipal = { actor: 'external_agent', clientId: 'c', scopes: [], session }
const RENDERS_APPS = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }
const READABLE = new Set(['p-1'])

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
})

beforeEach(() => {
  vi.spyOn(discovery, 'readOperationBody').mockImplementation(async (_ctx, _name, input) => {
    const id = String((input.params as { id?: string } | undefined)?.id)
    return READABLE.has(id) ? { body: { project: { id } } } : { refusal: 'project-overview-get was refused (HTTP 403).' }
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await __setHubTransportForTests(null)
})

const authInfo = (principal: AgentPrincipal): AuthInfo => ({ token: '', clientId: 'c', scopes: [], extra: { principal, mode: 'search' } })

function modern(method: string, params: Record<string, unknown>, capabilities: Record<string, unknown> = {}): Request {
  const uri = typeof params.uri === 'string' ? params.uri : undefined
  return new Request('https://app.example.test/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(uri ? { 'mcp-name': uri } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': capabilities,
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
        },
      },
    }),
  })
}

async function answer(principal: AgentPrincipal, method: string, params: Record<string, unknown>, capabilities?: Record<string, unknown>) {
  const response = await createAgentDoorHandler(() => undefined).fetch(modern(method, params, capabilities), { authInfo: authInfo(principal) })
  const raw = await response.text()
  const data = raw.split('\n').find((line) => line.startsWith('data:'))
  return JSON.parse(data ? data.slice(5) : raw) as { result?: Record<string, unknown>; error?: { message: string } }
}

interface Frame {
  method?: string
  params?: Record<string, unknown>
}

async function frames(response: Response, stop: (all: Frame[]) => boolean): Promise<Frame[]> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const all: Frame[] = []
  let buffer = ''
  const deadline = Date.now() + 2000
  while (Date.now() < deadline && !stop(all)) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) => setTimeout(() => resolve({ value: undefined, done: true }), 300)),
    ])
    if (done) break
    buffer += decoder.decode(value)
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const data = chunk.split('\n').find((line) => line.startsWith('data:'))
      if (data) all.push(JSON.parse(data.slice(5)) as Frame)
    }
  }
  void reader.cancel().catch(() => undefined)
  return all
}

function broker() {
  const handlers = new Map<string, Set<(payload: string) => void>>()
  const transport: EventTransport = {
    async publish(channel, payload) {
      for (const handler of handlers.get(channel) ?? []) handler(payload)
    },
    async subscribe(channel, onMessage) {
      const set = handlers.get(channel) ?? new Set()
      set.add(onMessage)
      handlers.set(channel, set)
      return async () => void set.delete(onMessage)
    },
  }
  return { transport, handlers }
}

describe('canonicalUri', () => {
  it.each([
    [RETIRED_GUIDE, GUIDE_URI],
    [RETIRED_PROJECT, 'workspace://project/p-1'],
    ['piloti://operation/project-list/result', 'workspace://operation/project-list/result'],
    [RETIRED_VIEW, PROPOSAL_CARD_URI],
    [GUIDE_URI, GUIDE_URI],
    ['https://piloti.example/guide', 'https://piloti.example/guide'],
  ])('maps %s to %s and leaves everything else as it is', (uri, expected) => {
    expect(canonicalUri(uri)).toBe(expected)
  })
})

describe('canonicalRequest', () => {
  it('rewrites a resource read in its body and its Mcp-Name header', async () => {
    const request = new Request('https://app.example.test/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-name': RETIRED_GUIDE },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: RETIRED_GUIDE } }),
    })
    const canonical = await canonicalRequest(request)
    expect(canonical.headers.get('mcp-name')).toBe(GUIDE_URI)
    expect(await canonical.json()).toMatchObject({ params: { uri: GUIDE_URI } })
  })

  it('rewrites the subscriptions a listen asks for', async () => {
    const request = new Request('https://app.example.test/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-method': 'subscriptions/listen' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'subscriptions/listen', params: { notifications: { resourceSubscriptions: [RETIRED_PROJECT, 'workspace://guide'] } } }),
    })
    const canonical = await canonicalRequest(request)
    expect(await canonical.json()).toMatchObject({ params: { notifications: { resourceSubscriptions: ['workspace://project/p-1', 'workspace://guide'] } } })
  })

  it('hands back the same request when nothing is retired', async () => {
    const request = new Request('https://app.example.test/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-name': GUIDE_URI },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: GUIDE_URI } }),
    })
    expect(await canonicalRequest(request)).toBe(request)
    expect(await canonicalRequest(new Request('https://app.example.test/api/mcp', { method: 'POST', body: 'not json' }))).toBeInstanceOf(Request)
  })
})

describe('an outside agent reads a resource under its retired scheme', () => {
  it('reads the guide under the retired address and gets it back under the new one', async () => {
    const { result } = await answer(outside, 'resources/read', { uri: RETIRED_GUIDE })
    expect(result?.contents).toEqual([expect.objectContaining({ uri: GUIDE_URI, mimeType: 'text/markdown' })])
    expect(JSON.stringify(result?.contents)).toContain('Working in')
  })

  it('lists only the new addresses', async () => {
    const { result } = await answer(outside, 'resources/list', {})
    const uris = (result?.resources as { uri: string }[]).map((resource) => resource.uri)
    expect(uris).toContain(GUIDE_URI)
    expect(uris.filter((uri) => uri.startsWith('piloti:'))).toEqual([])
  })

  it('reads the proposal card under the retired ui address, as the new one', async () => {
    const { result } = await answer(outside, 'resources/read', { uri: RETIRED_VIEW }, RENDERS_APPS)
    expect(result?.contents).toEqual([expect.objectContaining({ uri: PROPOSAL_CARD_URI, mimeType: 'text/html;profile=mcp-app' })])
  })
})

function listenRequest(notifications: Record<string, unknown>): Request {
  return new Request('https://app.example.test/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'subscriptions/listen',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'subscriptions/listen',
      params: {
        notifications,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
        },
      },
    }),
  })
}

describe('an outside agent listens to a project under its retired scheme', () => {
  it('acknowledges the subscription as the new address, and an event from a pod still on the old name reaches it', async () => {
    const { transport, handlers } = broker()
    await __setHubTransportForTests(transport)
    const response = await createAgentDoorHandler(() => undefined).fetch(
      listenRequest({ resourceSubscriptions: [RETIRED_PROJECT], resourcesListChanged: true }),
      { authInfo: authInfo(outside) },
    )
    const pending = frames(response, (all) => all.some((frame) => frame.method === 'notifications/resources/updated'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const [receive] = [...(handlers.get('rt:door:events') ?? [])]
    receive?.(JSON.stringify({ origin: 'another-pod', payload: { kind: 'resource_updated', organizationId: 'org_1', uri: RETIRED_PROJECT } }))
    const all = await pending
    expect(all.find((frame) => frame.method === 'notifications/subscriptions/acknowledged')?.params?.notifications).toMatchObject({
      resourceSubscriptions: ['workspace://project/p-1'],
    })
    expect(all.filter((frame) => frame.method === 'notifications/resources/updated').map((frame) => frame.params?.uri)).toEqual([
      'workspace://project/p-1',
    ])
  })
})

describe('the retired sensitive scope', () => {
  it('still opens the sensitive operations it opened, beside the new scope', () => {
    const holder: AgentPrincipal = { ...outside, scopes: [LEGACY_SENSITIVE_SCOPE], sensitiveOptIns: ['control'] }
    expect(maySeeSensitive(holder, 'control', true)).toBe(true)
    expect(maySeeSensitive({ ...holder, scopes: [] }, 'control', true)).toBe(false)
  })
})
