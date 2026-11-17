import type { InboxItem, InboxItemType } from '@/lib/db/schema/inbox'
import { INBOX_ITEM_TYPES } from '@/lib/db/schema/inbox'
import { INBOX_TYPE_DEFINITIONS, type InboxEmailDefault } from './registry'

export type InboxEmailCandidate = Pick<
  InboxItem,
  'type' | 'updatedAt' | 'readAt' | 'archivedAt' | 'resolvedAt' | 'inertAt'
>

export function emailDefaultFor(type: string): InboxEmailDefault {
  return (INBOX_ITEM_TYPES as readonly string[]).includes(type)
    ? INBOX_TYPE_DEFINITIONS[type as InboxItemType].email
    : { send: 'never' }
}

export function emailDueAt(row: InboxEmailCandidate): Date | null {
  const policy = emailDefaultFor(row.type)
  if (policy.send === 'never') return null
  return new Date(row.updatedAt.getTime() + policy.afterMinutes * 60_000)
}

export function isEmailDue(row: InboxEmailCandidate, now: Date = new Date()): boolean {
  if (row.readAt || row.archivedAt || row.resolvedAt || row.inertAt) return false
  const dueAt = emailDueAt(row)
  return dueAt !== null && dueAt.getTime() <= now.getTime()
}

export interface InboxEmailMessage {
  itemId: string
  type: InboxItemType
  recipientUserId: string
  recipientEmail: string
  title: string
  href: string
  locale: 'de' | 'en'
}

export interface InboxEmailSender {
  send(message: InboxEmailMessage): Promise<void>
}
