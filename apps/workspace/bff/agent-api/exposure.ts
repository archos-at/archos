import { EXPOSURE, type Exposure } from './exposure.config'
import type { AgentPrincipal } from './principal'
import { isAgentKind } from '@/lib/agent-kind'

export type AgentDoor = 'office' | 'platform'

export type Audience = 'external' | 'agent' | 'platform'

export function doorOfPrincipal(principal: Pick<AgentPrincipal, 'door'>): AgentDoor {
  return principal.door ?? 'office'
}

export function audienceOf(principal: Pick<AgentPrincipal, 'actor' | 'door'>): Audience {
  if (doorOfPrincipal(principal) === 'platform') return 'platform'
  return isAgentKind(principal.actor) ? 'agent' : 'external'
}

function exposureOf(name: string): Exposure | undefined {
  return Object.hasOwn(EXPOSURE, name) ? (EXPOSURE as Readonly<Record<string, Exposure>>)[name] : undefined
}

export function isExposedTo(audience: Audience, name: string): boolean {
  const entry = exposureOf(name)
  if (!entry || entry.withheld) return false
  if (audience === 'external') return entry.external
  if (audience === 'agent') return entry.agent === true
  return entry.platform === true
}

export function isOnDoor(name: string, door: AgentDoor = 'office'): boolean {
  const entry = exposureOf(name)
  if (!entry || entry.withheld) return false
  return door === 'platform' ? entry.platform === true : entry.external || entry.agent !== false
}

export function isAppToolFor(audience: Audience, name: string): boolean {
  const entry = exposureOf(name)
  return audience === 'external' && entry?.app === true && !entry.withheld
}

export function nativeToolOf(name: string): string | undefined {
  const native = exposureOf(name)?.agent
  return typeof native === 'string' ? native.slice('native:'.length) : undefined
}
