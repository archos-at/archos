import 'server-only'

import { waitingMailCounts } from '@/lib/inbound-mail/notice-repository'
import type { InboxItemView } from './types'

const LIVE_COUNTED: ReadonlySet<string> = new Set(['inbound_mail.waiting'])

function isLiveCounted(view: InboxItemView): boolean {
  return LIVE_COUNTED.has(view.type) && view.resourceType === 'project' && view.href !== null
}

// dev, 2026-11-06: a collapsed waiting-mail row counted occurrences since last read, so it fell to 0 on read and showed one mail beside an inbox of two.
export async function withLiveCounts(views: readonly InboxItemView[]): Promise<InboxItemView[]> {
  const projectIds = [...new Set(views.filter(isLiveCounted).map((view) => view.resourceId))]
  if (projectIds.length === 0) return [...views]
  const counts = await waitingMailCounts(projectIds)
  return views.map((view) => (isLiveCounted(view) ? { ...view, count: counts.get(view.resourceId) ?? 0 } : view))
}
