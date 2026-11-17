import 'server-only'
/**
 * The rows whose number is a state, not a tally.
 *
 * A collapsed row's `count` is occurrences since the reader last read it
 * (`markReadValues`, `./repository.ts`): right for „3 neue Nachrichten“, wrong
 * for „2 E-Mails warten auf Ablage“. A project's `inbound_mail.waiting` row
 * counted that way read „Eine E-Mail … wartet“ beside an E-Mail-Eingang with
 * two (dev, 2026-11-06: the count fell to 0 on read and rose by one with the
 * next mail, and a mail whose filing failed was never added). So, once it is
 * built for the reader, such a row says how many mails wait now, by the
 * E-Mail-Eingang's own rule (`waitingMailCounts`).
 *
 * Only a row whose target the reader may still reach (`href`) is counted: a
 * redacted row (access revoked, the project gone) keeps its stored tally, so
 * it never tells a former member how much waits now, and nothing is read for
 * it. Only the words change: the badge counts rows, read and unread stay.
 */

import { waitingMailCounts } from '@/lib/inbound-mail/notice-repository'
import type { InboxItemView } from './types'

/** The types whose row states how many wait now, read from the project. */
const LIVE_COUNTED: ReadonlySet<string> = new Set(['inbound_mail.waiting'])

function isLiveCounted(view: InboxItemView): boolean {
  return LIVE_COUNTED.has(view.type) && view.resourceType === 'project' && view.href !== null
}

/** The views, each live-counted one carrying what waits in its project now (0 once nothing does). */
export async function withLiveCounts(views: readonly InboxItemView[]): Promise<InboxItemView[]> {
  const projectIds = [...new Set(views.filter(isLiveCounted).map((view) => view.resourceId))]
  if (projectIds.length === 0) return [...views]
  const counts = await waitingMailCounts(projectIds)
  return views.map((view) => (isLiveCounted(view) ? { ...view, count: counts.get(view.resourceId) ?? 0 } : view))
}
