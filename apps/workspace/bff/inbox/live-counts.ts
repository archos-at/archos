import 'server-only'
/**
 * The rows whose number is a state, not a tally.
 *
 * A collapsed row's `count` is occurrences since the reader last read it
 * (`markReadValues`, `./repository.ts`): right for „3 neue Nachrichten“, wrong
 * for „2 E-Mails warten auf Ablage“. A project's `inbound_mail.waiting` row
 * counted that way read „Eine E-Mail … wartet“ beside an E-Mail-Eingang with
 * two (dev, 2026-11-06: the count fell to 0 on read and rose by one with the
 * next mail, and a mail whose filing failed was never added). So, when it is
 * read, such a row says how many mails wait now, by the E-Mail-Eingang's own
 * rule (`waitingMailCounts`). Only the words change: the badge counts rows,
 * and read and unread stay as they were.
 */

import type { InboxItem } from '@/lib/db/schema/inbox'
import { waitingMailCounts } from '@/lib/inbound-mail/notice-repository'

/** The types whose row states how many wait now, read from the project. */
const LIVE_COUNTED: ReadonlySet<string> = new Set(['inbound_mail.waiting'])

function isLiveCounted(row: InboxItem): boolean {
  return LIVE_COUNTED.has(row.type) && row.resourceType === 'project'
}

/** The rows, each live-counted one carrying what waits in its project now (0 once nothing does). */
export async function withLiveCounts<Row extends InboxItem>(rows: readonly Row[]): Promise<Row[]> {
  const projectIds = [...new Set(rows.filter(isLiveCounted).map((row) => row.resourceId))]
  if (projectIds.length === 0) return [...rows]
  const counts = await waitingMailCounts(projectIds)
  return rows.map((row) => (isLiveCounted(row) ? { ...row, count: counts.get(row.resourceId) ?? 0 } : row))
}
