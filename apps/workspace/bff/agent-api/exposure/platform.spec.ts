/**
 * @vitest-environment node
 */
/**
 * The door split (ADR-0158): every console operation is platform-public or
 * tenant content, and no tenant-content operation is reachable by an agent.
 * The platform door is where an operator's agent (Claude onboarding a country)
 * works, and its vendor is no processor of tenant content, so these cases hold
 * the line at each layer an agent meets: the config, the policy that reads it,
 * and the real MCP server on the platform door, listing, searching, describing
 * and calling.
 */

import { webcrypto } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dispatch')>()),
  callOperation: vi.fn(),
}))
vi.mock('../telemetry', () => ({ recordOperationCalled: vi.fn(), recordOperationMissing: vi.fn() }))

import { AGENT_OPERATIONS } from '../catalog'
import { callOperation } from '../dispatch'
import { type Audience, isExposedTo, isOnDoor } from '../exposure'
import { EXPOSURE, type Exposure } from '../exposure.config'
import { createAgentDoorHandler } from '../mcp-server'
import { documentedOperations } from '../openapi'
import { SENSITIVE_SCOPE, canSee, findVisibleOperation } from '../policy'
import type { AgentPrincipal } from '../principal'
import { PLATFORM_EXPOSURE, PLATFORM_PUBLIC } from './platform'

const entries = EXPOSURE as Readonly<Record<string, Exposure>>
const isTenantContent = (name: string) => entries[name]?.withheld?.category === 'tenant-content'

const PLATFORM_OPERATIONS = AGENT_OPERATIONS.filter((op) => op.domain === 'platform')
const TENANT_CONTENT = PLATFORM_OPERATIONS.filter((op) => isTenantContent(op.name)).map((op) => op.name)

/**
 * The console operations that read what offices wrote, as of ADR-0158. Pinned
 * here, so that flipping one to platform-public is a change to this spec too,
 * read in review, never a one-word edit of the config alone.
 */
const KNOWN_TENANT_CONTENT = [
  'platform-answer-feedback-digest-get',
  'platform-answer-feedback-export',
  'platform-answer-feedback-get',
  'platform-answer-feedback-options-get',
  'platform-citation-health-export',
  'platform-citation-health-get',
  'platform-feedback-claim',
  'platform-feedback-get',
  'platform-feedback-list',
  'platform-feedback-triage',
  'platform-lesson-get',
  'platform-lesson-list',
  'platform-lesson-sweep-run',
  'platform-lesson-update',
  'platform-org-usage-get',
  'platform-profiler-conversation-get',
  'platform-profiler-conversation-list',
  'platform-quality-scope-options',
]

/**
 * Console routes whose path says they read offices' turns, votes, reports or
 * lessons. A new operation on one of them is tenant content until someone
 * argues otherwise in this spec.
 */
const TENANT_CONTENT_PATH = /^\/api\/platform\/(feedback|answer-feedback|lessons|profiler|quality|citation-health|conversations)(\/|$)/

const session = {
  userId: 'user_1',
  email: 'operator@example.test',
  name: null,
  accessToken: '',
  organizationId: 'org_platform',
  organizationMembershipId: 'om_1',
  role: 'org-platform-owner',
  permissions: [],
  featureFlags: null,
}
const operatorAgent: AgentPrincipal = {
  actor: 'external_agent',
  clientId: 'client_claude',
  scopes: [SENSITIVE_SCOPE],
  sensitiveOptIns: ['access', 'secret', 'control'],
  session,
  door: 'platform',
}
const officeAgent: AgentPrincipal = { ...operatorAgent, door: undefined }
const AUDIENCES: readonly Audience[] = ['external', 'agent', 'platform']

describe('every console operation is classified', () => {
  it('as platform-public or tenant content, and as nothing else', () => {
    const unclassified = PLATFORM_OPERATIONS.filter((op) => entries[op.name] !== PLATFORM_PUBLIC && !isTenantContent(op.name))
    expect(unclassified.map((op) => op.name), 'give each PLATFORM_PUBLIC or tenantContent(reason)').toEqual([])
    expect(Object.keys(PLATFORM_EXPOSURE).sort()).toEqual(PLATFORM_OPERATIONS.map((op) => op.name).filter((n) => n in PLATFORM_EXPOSURE).sort())
  })

  it('keeps tenant content a console class: no office operation carries it', () => {
    const elsewhere = Object.keys(entries).filter((name) => isTenantContent(name) && !PLATFORM_OPERATIONS.some((op) => op.name === name))
    expect(elsewhere).toEqual([])
  })

  it('still holds every operation known to read tenant content as tenant content', () => {
    expect(KNOWN_TENANT_CONTENT.filter((name) => !isTenantContent(name))).toEqual([])
  })

  it('treats an operation on a route that reads offices’ turns, votes, reports or lessons as tenant content', () => {
    const misfiled = PLATFORM_OPERATIONS.filter((op) => TENANT_CONTENT_PATH.test(op.path) && !isTenantContent(op.name))
    expect(misfiled.map((op) => op.name)).toEqual([])
  })

  it('offers the operator’s agent the platform’s own data (positive control)', () => {
    const offered = PLATFORM_OPERATIONS.filter((op) => !isTenantContent(op.name)).map((op) => op.name)
    expect(offered).toContain('platform-knowledge-document-upload')
    expect(offered).toContain('platform-norm-registry-get')
    for (const name of offered) expect(isOnDoor(name, 'platform'), name).toBe(true)
  })
})

describe('no tenant-content operation is reachable by an agent', () => {
  it('is on no door and offered to no audience', () => {
    expect(TENANT_CONTENT.length).toBeGreaterThanOrEqual(KNOWN_TENANT_CONTENT.length)
    for (const name of TENANT_CONTENT) {
      expect(isOnDoor(name, 'platform'), name).toBe(false)
      expect(isOnDoor(name, 'office'), name).toBe(false)
      for (const audience of AUDIENCES) expect(isExposedTo(audience, name), `${name} to ${audience}`).toBe(false)
    }
  })

  // The in-product agent is the `agent` audience above: `canSee` asks `isExposedTo` for it first.
  it('is invisible to the operator’s agent and to an office’s agent, as if it did not exist', () => {
    for (const op of PLATFORM_OPERATIONS.filter((candidate) => isTenantContent(candidate.name))) {
      for (const principal of [operatorAgent, officeAgent]) {
        expect(canSee(principal, op), `${op.name} to ${principal.actor} on ${principal.door ?? 'office'}`).toBe(false)
        expect(findVisibleOperation(principal, op.name), op.name).toBeUndefined()
      }
    }
  })
})

describe('the OpenAPI document', () => {
  it('describes none of them, to platform staff either', () => {
    const documented = documentedOperations(AGENT_OPERATIONS, { platformStaff: true }).map((op) => op.name)
    expect(documented).toContain('platform-norm-registry-get')
    expect(documented.filter((name) => isTenantContent(name))).toEqual([])
  })
})

describe('the platform door, through the real MCP server', () => {
  const handler = createAgentDoorHandler(() => undefined)

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  })
  beforeEach(() => {
    vi.mocked(callOperation).mockReset().mockResolvedValue({ status: 200, ok: true, body: {} })
  })

  async function rpc(mode: 'search' | 'tools', method: string, params: object = {}): Promise<string> {
    const response = await handler.fetch(
      new Request('https://app.example.test/api/platform/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'mcp-protocol-version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
      { authInfo: { token: '', clientId: 'client_claude', scopes: [], extra: { principal: operatorAgent, mode } } },
    )
    return response.text()
  }
  const mentionsTenantContent = (text: string) => TENANT_CONTENT.filter((name) => text.includes(name))

  it('lists the platform’s own operations and none of the tenant-content ones', async () => {
    const listed = await rpc('tools', 'tools/list')
    expect(listed).toContain('"platform-norm-registry-get"')
    expect(mentionsTenantContent(listed)).toEqual([])
  })

  it('finds none of them by search, however the query is put', async () => {
    for (const query of ['feedback', 'conversation', 'profiler', 'lesson', 'answer ratings', 'citation health', 'usage', 'quality scope']) {
      const found = await rpc('search', 'tools/call', { name: 'search-operations', arguments: { query } })
      expect(mentionsTenantContent(found), query).toEqual([])
    }
  })

  it('describes and calls none of them: each reads as unknown, and no route runs', async () => {
    for (const name of TENANT_CONTENT) {
      const described = await rpc('search', 'tools/call', { name: 'describe-operation', arguments: { name } })
      const called = await rpc('search', 'tools/call', { name: 'call-operation', arguments: { name, input: {} } })
      const direct = await rpc('tools', 'tools/call', { name, arguments: {} })
      for (const text of [described, called]) expect(text, name).toContain(`Unknown operation`)
      // Not listed, so the SDK refuses it before any handler of ours runs.
      expect(direct, name).toContain(`Tool ${name} not found`)
      // Not even as a hint: a refusal suggests only what the door offers.
      for (const text of [described, called, direct]) expect(mentionsTenantContent(text.replaceAll(name, '')), name).toEqual([])
    }
    expect(callOperation).not.toHaveBeenCalled()
  })
})
