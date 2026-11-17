import type { AgentWakeStatus } from './types'

export const WAKE_END_REASON_KINDS = ['budget', 'busy', 'access', 'error'] as const
export type WakeEndReasonKind = (typeof WAKE_END_REASON_KINDS)[number]

const BUSY_REFUSALS = [
  /\bsend your message again in a moment\b/i,
  /\banswers in progress\b/i,
  /\bresearch jobs waiting\b/i,
]

export function wakeEndReasonKind(status: AgentWakeStatus, reason: string | null): WakeEndReasonKind | null {
  if (status !== 'failed' && status !== 'refused') return null
  const text = reason?.trim()
  if (!text) return null
  if (/\bbudget\b/i.test(text)) return 'budget'
  if (/^gave up waiting\b/i.test(text)) return 'busy'
  if (BUSY_REFUSALS.some((pattern) => pattern.test(text))) return 'busy'
  if (/^rejected: (auth_expired|conversation_mismatch)\b/.test(text)) return 'access'
  if (/^(auth_error|token_expired|token_invalid)$/.test(text)) return 'access'
  return 'error'
}
