import type { InboxItemView } from '@/lib/inbox/types'
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
