import 'server-only'
import { INBOX_TYPE_DEFINITIONS, inboxTypeDefinition } from '@/lib/inbox/registry'
import { pruneInboxItemsOlderThan } from '@/lib/inbox/repository'
import type { InboxItemType } from '@/lib/db/schema/inbox'

const PRUNE_BATCH = 1000

export interface RetentionResult {
  deleted: number
  cutoff: string
}

export async function pruneExpiredInboxItems(now = new Date()): Promise<RetentionResult> {
  const longestDays = Math.max(
    ...Object.values(INBOX_TYPE_DEFINITIONS).map((definition) => definition.retentionDays),
  )
  const cutoff = new Date(now.getTime() - longestDays * 24 * 60 * 60 * 1000)
  const deleted = await pruneInboxItemsOlderThan(cutoff, PRUNE_BATCH)
  return { deleted, cutoff: cutoff.toISOString() }
}

export function retentionDaysFor(type: InboxItemType): number {
  return inboxTypeDefinition(type).retentionDays
}
