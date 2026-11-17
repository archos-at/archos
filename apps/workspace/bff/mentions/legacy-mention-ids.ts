// drop after release 2026-W51
export const LEGACY_AGENT_MENTION_ID = 'agent:piloti'

export const isLegacyAgentMentionId = (targetId: string): boolean => targetId === LEGACY_AGENT_MENTION_ID
