import 'server-only'
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { pushSubscriptions, type PushSubscriptionRow } from '@/lib/db/schema/push-subscriptions'
import { withPlatformAccess } from '@/lib/db/tenant-context'

export const MAX_DEVICES_PER_PERSON = 10

export interface SubscriptionValues {
  organizationId: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  deviceLabel: string
}

export async function claimEndpoint(
  organizationId: string,
  userId: string,
  endpoint: string
): Promise<number> {
  const rows = await withPlatformAccess(
    'a device registered by a new person: removing the previous holder of the same browser endpoint',
    () =>
      getDb()
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, endpoint),
            sql`NOT (${pushSubscriptions.organizationId} = ${organizationId} AND ${pushSubscriptions.userId} = ${userId})`
          )
        )
        .returning({ id: pushSubscriptions.id })
  )
  return rows.length
}

export async function upsertSubscription(values: SubscriptionValues): Promise<PushSubscriptionRow> {
  const [row] = await getDb()
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: values.p256dh,
        auth: values.auth,
        deviceLabel: values.deviceLabel,
        failureCount: 0,
      },
      setWhere: and(
        eq(pushSubscriptions.organizationId, values.organizationId),
        eq(pushSubscriptions.userId, values.userId)
      ),
    })
    .returning()
  if (!row) throw new Error('push subscription could not be written: the endpoint belongs to another person')
  return row
}

export async function listSubscriptions(organizationId: string, userId: string): Promise<PushSubscriptionRow[]> {
  return getDb()
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.organizationId, organizationId), eq(pushSubscriptions.userId, userId)))
    .orderBy(desc(pushSubscriptions.createdAt))
    .limit(MAX_DEVICES_PER_PERSON + 1)
}

export async function deleteSubscription(organizationId: string, userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.id, id),
        eq(pushSubscriptions.organizationId, organizationId),
        eq(pushSubscriptions.userId, userId)
      )
    )
    .returning({ id: pushSubscriptions.id })
  return rows.length > 0
}

export async function deleteSubscriptionByEndpoint(
  organizationId: string,
  userId: string,
  endpoint: string
): Promise<boolean> {
  const rows = await getDb()
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.organizationId, organizationId),
        eq(pushSubscriptions.userId, userId)
      )
    )
    .returning({ id: pushSubscriptions.id })
  return rows.length > 0
}

export async function deleteAllSubscriptionsOf(organizationId: string, userId: string): Promise<number> {
  const rows = await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.organizationId, organizationId), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id })
  return rows.length
}

export async function trimSubscriptions(organizationId: string, userId: string): Promise<number> {
  const db = getDb()
  const keep = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.organizationId, organizationId), eq(pushSubscriptions.userId, userId)))
    .orderBy(desc(pushSubscriptions.createdAt))
    .limit(MAX_DEVICES_PER_PERSON)
  if (keep.length < MAX_DEVICES_PER_PERSON) return 0
  const dropped = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.organizationId, organizationId),
        eq(pushSubscriptions.userId, userId),
        notInArray(
          pushSubscriptions.id,
          keep.map((row) => row.id)
        )
      )
    )
    .returning({ id: pushSubscriptions.id })
  return dropped.length
}

export async function userIdsWithSubscription(
  organizationId: string,
  userIds: readonly string[]
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await getDb()
    .selectDistinct({ userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.organizationId, organizationId), inArray(pushSubscriptions.userId, [...userIds]))
    )
  return new Set(rows.map((row) => row.userId))
}

export async function recordDelivered(id: string): Promise<void> {
  await getDb()
    .update(pushSubscriptions)
    .set({ lastSuccessAt: new Date(), failureCount: 0 })
    .where(eq(pushSubscriptions.id, id))
}

export async function recordFailure(id: string): Promise<number | null> {
  const [row] = await getDb()
    .update(pushSubscriptions)
    .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
    .where(eq(pushSubscriptions.id, id))
    .returning({ failureCount: pushSubscriptions.failureCount })
  return row?.failureCount ?? null
}

export async function deleteSubscriptionById(id: string): Promise<void> {
  await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.id, id))
}
