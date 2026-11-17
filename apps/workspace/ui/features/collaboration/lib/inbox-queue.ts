import type { InboxItemView } from '@/lib/inbox/types'

export function isOpenRequest(item: InboxItemView): boolean {
  return item.actionable && item.state !== 'resolved' && item.state !== 'inert' && !item.archived
}

export function urgencyOf(item: InboxItemView, today: string): number {
  if (item.variant === 'overdue') return 0
  if (item.dueOn && item.dueOn < today) return 0
  if (item.variant === 'due_soon') return 1
  if (item.dueOn) return 2
  return 3
}

function byUrgency(today: string) {
  return (a: InboxItemView, b: InboxItemView): number =>
    urgencyOf(a, today) - urgencyOf(b, today) ||
    (a.dueOn && b.dueOn ? a.dueOn.localeCompare(b.dueOn) : 0) ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
}

export interface InboxQueueGroup {
  key: string
  subject: string | null
  projectName: string | null
  chat: boolean
  items: InboxItemView[]
}

function groupKeyOf(item: InboxItemView): string {
  const gathers = (item.resourceType === 'document' || item.resourceType === 'conversation') && item.subject !== null
  return gathers ? `${item.resourceType}:${item.resourceId}` : `item:${item.id}`
}

export function waitingGroups(items: readonly InboxItemView[], today: string): InboxQueueGroup[] {
  const groups = new Map<string, InboxQueueGroup>()
  for (const item of items.filter(isOpenRequest).sort(byUrgency(today))) {
    const key = groupKeyOf(item)
    const group = groups.get(key)
    if (group) {
      group.items.push(item)
      continue
    }
    groups.set(key, {
      key,
      subject: key.startsWith('item:') ? null : item.subject,
      projectName: item.projectName ?? null,
      chat: item.resourceType === 'conversation',
      items: [item],
    })
  }
  return [...groups.values()]
}

export function newsOf(items: readonly InboxItemView[]): InboxItemView[] {
  return items.filter((item) => !item.read && item.state !== 'inert' && !item.archived && !isOpenRequest(item))
}

export function newsWithHeld(
  news: readonly InboxItemView[],
  held: { item: InboxItemView; at: number } | null,
): InboxItemView[] {
  if (!held || news.some((item) => item.id === held.item.id)) return [...news]
  const at = Math.min(Math.max(held.at, 0), news.length)
  return [...news.slice(0, at), held.item, ...news.slice(at)]
}

export function queueOrder(groups: readonly InboxQueueGroup[], news: readonly InboxItemView[]): InboxItemView[] {
  return [...groups.flatMap((group) => group.items), ...news]
}

export function isAtHref(href: string, pathname: string, params: Pick<URLSearchParams, 'get'> | null): boolean {
  const target = new URL(href, 'https://inbox.invalid')
  if (target.pathname !== pathname) return false
  for (const [key, value] of target.searchParams) {
    if (key === 'back') continue
    if (params?.get(key) !== value) return false
  }
  return true
}
