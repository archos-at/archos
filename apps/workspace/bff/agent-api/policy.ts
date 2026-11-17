import { BACKEND_OPERATIONS, type BackendOperation, findBackendOperation } from './backend-operations'
import { AGENT_OPERATIONS, findOperation } from './catalog'
import { type AgentDoor, audienceOf, isExposedTo, isOnDoor } from './exposure'
import { AGENT_DOMAINS, type AgentDomain, type AgentOperation, type Sensitivity, annotationsOf } from './operation'
import type { AgentPrincipal } from './principal'

export const SENSITIVE_SCOPE = 'piloti:sensitive'

export const SENSITIVE_SCOPE_ENFORCED_BY_WORKOS = false

export type { AgentDoor, Audience } from './exposure'
export { doorOfPrincipal, isOnDoor, nativeToolOf } from './exposure'

export type CallDecision = 'run' | 'propose'

export function canSee(principal: AgentPrincipal, op: { readonly name: string; readonly sensitivity?: Sensitivity }): boolean {
  if (!isExposedTo(audienceOf(principal), op.name)) return false
  return !op.sensitivity || maySeeSensitive(principal, op.sensitivity)
}

export function maySeeSensitive(
  principal: AgentPrincipal,
  sensitivity: Sensitivity,
  scopeEnforced: boolean = SENSITIVE_SCOPE_ENFORCED_BY_WORKOS,
): boolean {
  if (principal.actor !== 'external_agent') return false
  return (
    (principal.sensitiveOptIns ?? []).includes(sensitivity) && scopeEnforced && principal.scopes.includes(SENSITIVE_SCOPE)
  )
}

export function visibleDomains(door: AgentDoor = 'office'): readonly AgentDomain[] {
  const onDoor = new Set<AgentDomain>([
    ...AGENT_OPERATIONS.filter((op) => isOnDoor(op.name, door)).map((op) => op.domain),
    ...BACKEND_OPERATIONS.filter((op) => isOnDoor(op.name, door)).map((op) => op.domain),
  ])
  return AGENT_DOMAINS.filter((domain) => onDoor.has(domain))
}

export function visibleOperations(principal: AgentPrincipal): readonly AgentOperation[] {
  return AGENT_OPERATIONS.filter((op) => canSee(principal, op))
}

export function findVisibleOperation(principal: AgentPrincipal, name: string): AgentOperation | undefined {
  const op = findOperation(name)
  return op && canSee(principal, op) ? op : undefined
}

export function visibleBackendOperations(principal: AgentPrincipal): readonly BackendOperation[] {
  return BACKEND_OPERATIONS.filter((op) => canSee(principal, op))
}

export const RENAMED_BACKEND_OPERATIONS: Readonly<Record<string, string>> = {
  'knowledge-image-view': 'document-look',
}

export function findVisibleBackendOperation(principal: AgentPrincipal, name: string): BackendOperation | undefined {
  const op = findBackendOperation(name) ?? findBackendOperation(RENAMED_BACKEND_OPERATIONS[name] ?? '')
  return op && canSee(principal, op) ? op : undefined
}

export function callDecision(principal: AgentPrincipal, op: AgentOperation): CallDecision {
  if (principal.actor === 'external_agent') return 'run'
  return annotationsOf(op).readOnlyHint ? 'run' : 'propose'
}
