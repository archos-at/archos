import type { InboxItemView } from '@/lib/inbox/types'
import { markOf } from '../hooks/use-inbox-mark'
import { isOpenRequest } from './inbox-queue'

export function isOverdue(item: InboxItemView): boolean {
  return isOpenRequest(item) && item.variant === 'overdue'
}

export function newestFirstOverdueOnTop(items: readonly InboxItemView[]): InboxItemView[] {
  return [...items].sort(
    (a, b) =>
      Number(isOverdue(b)) - Number(isOverdue(a)) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      b.id.localeCompare(a.id)
  )
}

export function sameDocumentAs(entries: readonly InboxItemView[], item: InboxItemView): InboxItemView[] {
  if (!markOf(item)) return []
  const at = entries.findIndex((entry) => entry.id === item.id)
  const ordered = at < 0 ? entries : [...entries.slice(at + 1), ...entries.slice(0, at)]
  return ordered.filter((entry) => entry.id !== item.id && markOf(entry)?.documentId === item.resourceId)
}

export function nextAfterLeaving(entries: readonly InboxItemView[], itemId: string): InboxItemView | null {
  const at = entries.findIndex((entry) => entry.id === itemId)
  if (at < 0) return null
  const left = entries[at]
  const onSameDocument = sameDocumentAs(entries, left)[0]
  if (onSameDocument) return onSameDocument
  const rest = entries.filter((entry) => entry.id !== itemId)
  return rest[Math.min(at, rest.length - 1)] ?? null
}
