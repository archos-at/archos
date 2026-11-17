// drop after release 2026-W48
export const LEGACY_FLAG_KEYS: Readonly<Partial<Record<string, string>>> = {
  'agent-thread-replies': 'piloti-wakes',
  'agent-direct-edits': 'piloti-acts',
  'revision-suggestions': 'piloti-notices',
  'agent-requests': 'piloti-ask',
}

export const LEGACY_AGENT_DIRECT_EDITS_OFF = {
  code: 'PILOTI_ACTS_OFF',
  reason: 'piloti-acts-off',
} as const
