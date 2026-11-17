export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value)
}

export function validateReasoningEffort(effort: unknown): string | null {
  if (!isReasoningEffort(effort)) {
    return `not a reasoning effort (expected one of: ${REASONING_EFFORTS.join(', ')})`
  }
  return null
}

export const CHAT_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const

export type ChatEffort = (typeof CHAT_EFFORTS)[number]

export const DEFAULT_CHAT_EFFORT: ChatEffort = 'medium'

export const CHAT_EFFORT_SETTING = 'chatReasoningEffort'

export function isChatEffort(value: unknown): value is ChatEffort {
  return typeof value === 'string' && (CHAT_EFFORTS as readonly string[]).includes(value)
}

export function chatEffortFromSettings(settings: Record<string, unknown> | null | undefined): ChatEffort {
  const stored = settings?.[CHAT_EFFORT_SETTING]
  return isChatEffort(stored) ? stored : DEFAULT_CHAT_EFFORT
}
