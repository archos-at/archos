import 'server-only'
import { publishToUser } from '@/lib/events/bus'
import type { InboxItemType, InboxTargetType, NewInboxItem } from '@/lib/db/schema/inbox'
import { enqueueInboxPushes } from '@/lib/push/enqueue'
import { upsertInboxItems } from './repository'
import { inboxItemIsActionable } from './registry'
import { canonicalInboxType } from './types'

export interface InboxEmission {
  organizationId: string
  recipientUserId: string
  type: InboxItemType
  resourceType: InboxTargetType
  resourceId: string
  anchorId?: string | null
  actorUserId?: string | null
  groupKey: string
  payload?: Record<string, unknown>
  occurrences?: number
}

export function upsertWaves<T extends { recipientUserId: string; groupKey: string }>(rows: readonly T[]): T[][] {
  const waves: T[][] = []
  const seenByWave: Array<Set<string>> = []
  for (const row of rows) {
    const key = `${row.recipientUserId}\u0000${row.groupKey}`
    let index = seenByWave.findIndex((seen) => !seen.has(key))
    if (index < 0) {
      index = waves.length
      waves.push([])
      seenByWave.push(new Set())
    }
    waves[index].push(row)
    seenByWave[index].add(key)
  }
  return waves
}

export async function emitInboxItems(emissions: InboxEmission[]): Promise<number> {
  const rows: NewInboxItem[] = emissions
    .filter((emission) => emission.recipientUserId !== emission.actorUserId)
    .map((emission) => ({
      organizationId: emission.organizationId,
      recipientUserId: emission.recipientUserId,
      type: emission.type,
      resourceType: emission.resourceType,
      resourceId: emission.resourceId,
      anchorId: emission.anchorId ?? null,
      actorUserId: emission.actorUserId ?? null,
      groupKey: emission.groupKey,
      actionable: inboxItemIsActionable(emission.type),
      payload: emission.payload ?? {},
      count: Math.max(1, Math.floor(emission.occurrences ?? 1)),
    }))

  if (rows.length === 0) return 0

  const inserted = []
  for (const wave of upsertWaves(rows)) inserted.push(...(await upsertInboxItems(wave)))

  await enqueueInboxPushes(inserted)

  await Promise.all(
    [...new Set(rows.map((row) => row.recipientUserId))].map(async (recipientUserId) => {
      const emission = rows.find((row) => row.recipientUserId === recipientUserId)
      if (!emission) return
      await publishToUser(recipientUserId, {
        kind: 'inbox.changed',
        pending: -1,
        itemType: canonicalInboxType(emission.type) as InboxItemType,
      })
    }),
  )

  return inserted.length
}
