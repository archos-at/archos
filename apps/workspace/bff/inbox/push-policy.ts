import type { InboxItem } from '@/lib/db/schema/inbox'
import { INBOX_ITEM_TYPES, type InboxItemType } from '@/lib/db/schema/inbox'
import type { PushCategory, PushPreferences, PushUrgency } from './push-categories'
import { INBOX_TYPE_DEFINITIONS, type InboxPushPolicy } from './registry'

export function pushPolicyFor(type: string): InboxPushPolicy | null {
  return (INBOX_ITEM_TYPES as readonly string[]).includes(type)
    ? INBOX_TYPE_DEFINITIONS[type as InboxItemType].push
    : null
}

export function pushCategoryOf(type: string, payload?: unknown): PushCategory | null {
  const policy = pushPolicyFor(type)
  if (!policy) return null
  const yours = typeof payload === 'object' && payload !== null && (payload as { yours?: unknown }).yours === true
  return yours && policy.yours ? policy.yours : policy.category
}

export function isPushWanted(type: string, preferences: PushPreferences, payload?: unknown): boolean {
  const category = pushCategoryOf(type, payload)
  return category !== null && preferences.categories[category]
}

export type InboxPushCandidate = Pick<InboxItem, 'type' | 'readAt' | 'archivedAt' | 'resolvedAt' | 'inertAt'>

export function isPushStillDue(row: InboxPushCandidate): boolean {
  return !row.readAt && !row.archivedAt && !row.resolvedAt && !row.inertAt && pushPolicyFor(row.type) !== null
}

export const PUSH_TTL_SECONDS: Readonly<Record<PushUrgency, number>> = {
  high: 24 * 60 * 60,
  normal: 6 * 60 * 60,
  low: 60 * 60,
}
