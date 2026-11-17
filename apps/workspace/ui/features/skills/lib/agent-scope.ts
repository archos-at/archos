export const SKILL_AGENTS = ['researcher', 'deep_researcher'] as const
export type SkillAgent = (typeof SKILL_AGENTS)[number]

const AGENT_ALIASES: Record<string, SkillAgent> = {
  shallow_researcher: 'researcher',
}

export function canonicalAgent(name: string): string {
  return AGENT_ALIASES[name] ?? name
}

export interface AgentScope {
  selected: SkillAgent[]
  unknown: string[]
}

function split(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function isAgent(name: string): name is SkillAgent {
  return (SKILL_AGENTS as readonly string[]).includes(name)
}

export function parseAgentScope(raw: string | undefined): AgentScope {
  const listed = split(raw).map(canonicalAgent)
  const selected = listed.filter(isAgent)
  return {
    selected: selected.length > 0 ? selected : [...SKILL_AGENTS],
    unknown: listed.filter((name) => !isAgent(name)),
  }
}

export function formatAgentScope(scope: AgentScope): string {
  const restricted = scope.selected.length > 0 && scope.selected.length < SKILL_AGENTS.length
  return [...(restricted ? scope.selected : []), ...scope.unknown].join(',')
}

export function agentScopeLabelKey(raw: string | undefined): 'chatOnly' | 'deepOnly' | null {
  const known = split(raw).map(canonicalAgent).filter(isAgent)
  if (known.length === 0 || known.length === SKILL_AGENTS.length) return null
  return known[0] === 'researcher' ? 'chatOnly' : 'deepOnly'
}
