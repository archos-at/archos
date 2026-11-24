import type { InboxItemView } from '@/lib/inbox/types'

export function isOpenRequest(item: InboxItemView): boolean {
  return item.actionable && item.state !== 'resolved' && item.state !== 'inert' && !item.archived
}
