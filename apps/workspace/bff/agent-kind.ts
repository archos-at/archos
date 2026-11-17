import { LEGACY_AGENT_KIND } from './legacy-agent-kind'

export const AGENT_KIND = 'agent' as const

export const AGENT_KINDS = [AGENT_KIND, LEGACY_AGENT_KIND] as const

export type AgentKind = (typeof AGENT_KINDS)[number]

export const isAgentKind = (value: unknown): value is AgentKind =>
  value === AGENT_KIND || value === LEGACY_AGENT_KIND
