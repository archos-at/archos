import 'server-only'
import type { InboxItem } from '@/lib/db/schema/inbox'
import { isPushStillDue, pushPolicyFor } from '@/lib/inbox/push-policy'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { webPushConfig } from './config'
import { userIdsWithSubscription } from './repository'

export const BURST_HOLD_MS = 5_000

const held = (row: InboxItem) => row.count > 1 || Boolean(pushPolicyFor(row.type)?.fold)

export async function enqueueInboxPushes(rows: readonly InboxItem[], now: Date = new Date()): Promise<number> {
  try {
    if (!webPushConfig()) return 0
    const due = rows.filter(isPushStillDue)
    if (due.length === 0) return 0
    const byOrganization = new Map<string, InboxItem[]>()
    for (const row of due) byOrganization.set(row.organizationId, [...(byOrganization.get(row.organizationId) ?? []), row])

    let queued = 0
    for (const [organizationId, group] of byOrganization) {
      const withDevice = await userIdsWithSubscription(organizationId, [...new Set(group.map((r) => r.recipientUserId))])
      for (const row of group.filter((r) => withDevice.has(r.recipientUserId))) {
        await enqueueJob({
          kind: 'inbox_push',
          organizationId,
          priority: BFF_JOB_PRIORITY.interactive,
          payload: { itemId: row.id, recipientUserId: row.recipientUserId, stamp: row.updatedAt.toISOString() },
          ...(held(row) ? { notBefore: new Date(now.getTime() + BURST_HOLD_MS) } : {}),
        })
        queued += 1
      }
    }
    return queued
  } catch (cause) {
    console.error('[push] could not queue notifications for inbox items:', cause)
    return 0
  }
}
