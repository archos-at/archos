import { describe, expect, test, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { AgentPrincipal } from './principal'
import { sessionSourceOf } from './telemetry'

const principal = (actor: AgentPrincipal['actor'], clientId: string | null): AgentPrincipal =>
  ({ actor, clientId, scopes: [], session: {} }) as unknown as AgentPrincipal

describe('sessionSourceOf', () => {
  test('Piloti in a person chat is the UI', () => {
    expect(sessionSourceOf({ principal: principal('piloti', null) })).toBe('ui')
  })

  test('an outside agent on an OAuth client is mcp', () => {
    expect(sessionSourceOf({ principal: principal('external_agent', 'client_1') })).toBe('mcp')
  })

  test('an outside agent whose token names no client is a script', () => {
    expect(sessionSourceOf({ principal: principal('external_agent', null) })).toBe('script')
  })
})
