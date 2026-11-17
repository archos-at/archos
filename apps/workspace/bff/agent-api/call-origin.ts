import type { AgentPrincipal } from './principal'

export type CallDoor = 'mcp' | 'piloti' | 'a2a' | 'platform'

export type SessionSource = 'ui' | 'mcp' | 'script'

export interface CallOrigin {
  principal: AgentPrincipal
  door?: CallDoor
}

export function callDoorOf({ principal, door }: CallOrigin): CallDoor {
  if (door) return door
  if (principal.door === 'platform') return 'platform'
  return principal.actor === 'external_agent' ? 'mcp' : 'piloti'
}

export function sessionSourceOf({ principal }: Pick<CallOrigin, 'principal'>): SessionSource {
  if (principal.actor !== 'external_agent') return 'ui'
  return principal.clientId ? 'mcp' : 'script'
}

export function actingDoorOf(origin: CallOrigin): { door: CallDoor; sessionSource: SessionSource } {
  return { door: callDoorOf(origin), sessionSource: sessionSourceOf(origin) }
}
