export interface AgentGroupRequirements {
  requiredParameters: string[]
  minContextLength: number
  reasoningOff?: boolean
  requiresImageInput?: boolean
}

export interface AgentGroupDefinition {
  id: string
  label: string
  description: string
  configLlmRefs: string[]
  requirements: AgentGroupRequirements
}

export const AGENT_GROUPS: AgentGroupDefinition[] = [
  {
    id: 'clarifier',
    label: 'Clarifier',
    description:
      'Asks clarification questions and drafts research plans before deep research. Calls tools (e.g. web search) for context.',
    configLlmRefs: ['clarifier_llm'],
    requirements: { requiredParameters: ['tools'], minContextLength: 32768 },
  },
  {
    id: 'shallow_research',
    label: 'Research',
    description: 'The default research agent: iterative tool-calling over knowledge and web sources.',
    configLlmRefs: ['research_llm'],
    requirements: { requiredParameters: ['tools'], minContextLength: 65536 },
  },
  {
    id: 'deep_research',
    label: 'Deep research',
    description:
      'Orchestrator, planner, researcher, and report writer of multi-phase deep research. The heaviest reasoning and longest contexts in the system.',
    configLlmRefs: ['deep_orchestrator_llm', 'deep_planner_llm', 'deep_researcher_llm'],
    requirements: { requiredParameters: ['tools'], minContextLength: 131072 },
  },
  {
    id: 'deep_research_router',
    label: 'Deep-research source router',
    description: 'Routes deep-research subtasks to data sources. Small, high-frequency structured outputs.',
    configLlmRefs: ['deep_router_llm'],
    requirements: { requiredParameters: [], minContextLength: 16384 },
  },
  {
    id: 'memory_reflection',
    label: 'Memory reflection',
    description:
      'Post-answer background pass that distills durable project memory from a finished turn. Cost-sensitive; runs after every substantive answer when enabled.',
    configLlmRefs: ['card_llm'],
    requirements: { requiredParameters: [], minContextLength: 32768 },
  },
  {
    id: 'follow_ups',
    label: 'Follow-up questions',
    description:
      'Post-answer background pass that reads the finished answer and proposes the two to four questions it just made askable. Short structured output; runs on substantive answers when enabled.',
    configLlmRefs: ['follow_ups_llm'],
    requirements: { requiredParameters: [], minContextLength: 32768, reasoningOff: true },
  },
  {
    id: 'ingest_vlm',
    label: 'Document vision (ingestion)',
    description:
      'Captions images and describes vector/scanned drawings (plans, sections, elevations, perspectives) during document ingestion. Must be a vision model that accepts image input.',
    configLlmRefs: ['vlm'],
    requirements: { requiredParameters: [], minContextLength: 0, requiresImageInput: true },
  },
]

export const AGENT_GROUP_IDS = AGENT_GROUPS.map((group) => group.id)

export function isAgentGroupId(id: string): boolean {
  return AGENT_GROUP_IDS.includes(id)
}

export function getAgentGroup(id: string): AgentGroupDefinition | undefined {
  return AGENT_GROUPS.find((group) => group.id === id)
}

export const OPENROUTER_MODEL_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}\/[A-Za-z0-9_.:-]{1,128}$/

export const MODEL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}(\/[A-Za-z0-9_.:-]{1,128})?$/
