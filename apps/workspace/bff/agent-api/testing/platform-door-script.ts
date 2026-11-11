/**
 * A scripted client of the platform door, with no model (ADR-0170): what the
 * onboarding specs drive the real MCP handler with. One copy, so the AT-9 case
 * and the synthetic country (ADR-0174) speak to the door the same way.
 *
 * `door` makes one `call-operation`; when the server asks the person, the
 * script answers as told (`person: 'yes' | 'no'`), and a client without form
 * elicitation (`elicits: false`) gets the refusal that names where to decide.
 */

import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server'
import { expect } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AgentPrincipal } from '../principal'

export const ELICITS = { elicitation: { form: {} } }

export interface Rpc {
  result?: Record<string, unknown> & {
    content?: { text: string }[]
    isError?: boolean
    resultType?: string
    structuredContent?: Record<string, unknown>
    requestState?: string
  }
  error?: { code: number; message: string }
}

export interface Answer {
  ok: boolean
  body: Record<string, unknown>
  problem?: { code: string; status: number; detail: string; details?: unknown; type: string }
  raw: Rpc
}

type Handler = ReturnType<typeof import('../mcp-server').createAgentDoorHandler>

export function platformSession(organizationId: string, userId: string, permissions: string[]): AuthorizedSession {
  return {
    userId,
    email: `${userId}@example.test`,
    name: null,
    accessToken: '',
    organizationId,
    organizationMembershipId: `om_${userId}`,
    role: 'member',
    roles: ['member'],
    permissions,
    featureFlags: null,
  }
}

export const platformOperator = (who: AuthorizedSession): AgentPrincipal => ({
  actor: 'external_agent',
  clientId: 'client_claude',
  scopes: [],
  session: who,
  door: 'platform',
})

export function doorScript(handler: () => Handler) {
  async function rpc(principal: AgentPrincipal, method: string, params: Record<string, unknown>, capabilities: Record<string, unknown> = ELICITS): Promise<Rpc> {
    const response = await handler().fetch(
      new Request('https://app.example.test/api/platform/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          ...(method === 'tools/call' ? { 'mcp-name': 'call-operation' } : {}),
          ...(method === 'resources/read' ? { 'mcp-name': String(params.uri) } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
              [CLIENT_INFO_META_KEY]: { name: 'onboarding-script', version: '1.0.0' },
              [CLIENT_CAPABILITIES_META_KEY]: capabilities,
            },
          },
        }),
      }),
      { authInfo: { token: '', clientId: principal.clientId ?? '', scopes: [], extra: { principal, mode: 'search' } } },
    )
    return JSON.parse(await response.text()) as Rpc
  }

  async function door(
    principal: AgentPrincipal,
    name: string,
    input: Record<string, unknown>,
    options: { person?: 'yes' | 'no'; elicits?: boolean } = {},
  ): Promise<Answer> {
    const capabilities = options.elicits === false ? {} : ELICITS
    const args = { name: 'call-operation', arguments: { name, input } }
    let answer = await rpc(principal, 'tools/call', args, capabilities)
    if (answer.result?.resultType === 'input_required') {
      expect(options.person, `${name} asked the person, and the script was not told what they say`).toBeDefined()
      const confirm = options.person === 'yes' ? { action: 'accept', content: { confirm: true } } : { action: 'decline' }
      answer = await rpc(principal, 'tools/call', { ...args, inputResponses: { confirm }, requestState: answer.result.requestState }, capabilities)
    }
    const result = answer.result
    expect(result, JSON.stringify(answer.error)).toBeDefined()
    const structured = (result?.structuredContent ?? {}) as Record<string, unknown>
    if (result?.isError) return { ok: false, body: structured, problem: structured.problem as Answer['problem'], raw: answer }
    const body = (structured.result === undefined ? structured : structured.result) as Record<string, unknown>
    return { ok: true, body, raw: answer }
  }

  async function ok(principal: AgentPrincipal, name: string, input: Record<string, unknown>, options: { person?: 'yes' | 'no' } = {}) {
    const answer = await door(principal, name, input, options)
    expect(answer.ok, `${name}: ${JSON.stringify(answer.problem ?? answer.body)}`).toBe(true)
    return answer.body
  }

  return { rpc, door, ok }
}
