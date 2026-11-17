// drop after release 2026-W48
import type { InboxItemType } from '@/lib/inbox/inbox-vocabulary'

export const LEGACY_AGENT_INBOX_TYPES = {
  'piloti.work_done': 'agent.work_done',
  'piloti.work_failed': 'agent.work_failed',
  'piloti.asks_you': 'agent.asks_you',
  'piloti.proposal_waiting': 'agent.proposal_waiting',
  'piloti.intake_ready': 'agent.intake_ready',
  'piloti.revision_checked': 'agent.revision_checked',
} as const satisfies Readonly<Record<string, InboxItemType>>

export type LegacyAgentInboxType = keyof typeof LEGACY_AGENT_INBOX_TYPES

export type StoredInboxType = InboxItemType | LegacyAgentInboxType

const STORED_SPELLING: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LEGACY_AGENT_INBOX_TYPES).map(([legacy, current]) => [current, legacy]),
)

export function storedInboxType(type: StoredInboxType): StoredInboxType {
  return (STORED_SPELLING[type] ?? type) as StoredInboxType
}
