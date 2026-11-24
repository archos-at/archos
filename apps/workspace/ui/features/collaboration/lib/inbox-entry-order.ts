import type { InboxItemView } from '@/lib/inbox/types'
import { isOpenRequest } from './inbox-queue'

export function isOverdue(item: InboxItemView, today: string): boolean {
  return isOpenRequest(item) && (item.variant === 'overdue' || (item.dueOn != null && item.dueOn < today))
}

export function newestFirstOverdueOnTop(items: readonly InboxItemView[], today: string): InboxItemView[] {
  return [...items].sort(
    (a, b) =>
      Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      b.id.localeCompare(a.id)
  )
}
