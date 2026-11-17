import type { InboundMailSummaryView, InboundMailThreadGroupView } from './inbound-mail-wire'

export interface FilingOrderFacts {
  id: string
  sentAt: Date | string | null
  receivedAt: Date | string
}

const time = (value: Date | string | null): number => (value === null ? Number.NaN : new Date(value).getTime())

export function byFilingOrder(a: FilingOrderFacts, b: FilingOrderFacts): number {
  const sentA = time(a.sentAt)
  const sentB = time(b.sentAt)
  const sent = (Number.isNaN(sentA) ? time(a.receivedAt) : sentA) - (Number.isNaN(sentB) ? time(b.receivedAt) : sentB)
  if (sent !== 0) return sent
  return time(a.receivedAt) - time(b.receivedAt) || a.id.localeCompare(b.id)
}

function joinsThreadGroup(summary: InboundMailSummaryView): boolean {
  return summary.status === 'waiting' && !summary.automatic && summary.thread?.preselected === true
}

export function threadGroupsOf(
  entries: ReadonlyArray<{ summary: InboundMailSummaryView; order: FilingOrderFacts }>,
): InboundMailThreadGroupView[] {
  const byThread = new Map<string, Array<{ summary: InboundMailSummaryView; order: FilingOrderFacts }>>()
  for (const entry of entries) {
    const thread = entry.summary.thread
    if (!thread || !joinsThreadGroup(entry.summary)) continue
    byThread.set(thread.threadId, [...(byThread.get(thread.threadId) ?? []), entry])
  }
  const groups: InboundMailThreadGroupView[] = []
  for (const [threadId, members] of byThread) {
    if (members.length < 2) continue
    const first = Math.min(...members.map((member) => member.summary.thread?.nextVersion ?? 1))
    const ordered = [...members].sort((a, b) => byFilingOrder(a.order, b.order))
    groups.push({
      threadId,
      name: members[0]?.summary.thread?.name ?? '',
      mails: ordered.map((member, index) => ({ mailId: member.summary.id, version: first + index })),
      firstVersion: first,
      lastVersion: first + ordered.length - 1,
    })
  }
  return groups
}
