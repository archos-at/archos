export type InboxDayGroup = 'today' | 'yesterday' | 'week' | 'older'

export interface InboxSection<T> {
  group: InboxDayGroup
  items: T[]
}

const DAY_MS = 86_400_000

function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
}

export function dayGroupOf(iso: string, now: Date): InboxDayGroup {
  const today = startOfDay(now)
  const at = Date.parse(iso)
  if (Number.isNaN(at) || at >= today) return 'today'
  if (at >= today - DAY_MS) return 'yesterday'
  if (at >= today - 6 * DAY_MS) return 'week'
  return 'older'
}

export function inboxSections<T extends { updatedAt: string }>(items: readonly T[], now: Date): InboxSection<T>[] {
  const sections: InboxSection<T>[] = []
  for (const item of items) {
    const group = dayGroupOf(item.updatedAt, now)
    const last = sections.at(-1)
    if (last && last.group === group) last.items.push(item)
    else sections.push({ group, items: [item] })
  }
  return sections
}
