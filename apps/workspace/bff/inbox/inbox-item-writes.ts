import 'server-only'
import { and, eq, inArray, lt, notExists, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations } from '@/lib/db/schema/conversations'
import { documents } from '@/lib/db/schema/documents'
import { inboxItems, type InboxItem, type NewInboxItem } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { canonicalItem, canonicalRows, storedItem } from './canonical-rows'

export async function upsertInboxItem(values: NewInboxItem): Promise<InboxItem> {
  const db = getDb()
  const [row] = await db
    .insert(inboxItems)
    .values(storedItem(values))
    .onConflictDoUpdate({
      target: [inboxItems.recipientUserId, inboxItems.groupKey],
      set: {
        count: sql`${inboxItems.count} + excluded.count`,
        updatedAt: new Date(),
        actorUserId: values.actorUserId ?? null,
        anchorId: values.anchorId ?? null,
        payload: values.payload ?? {},
        readAt: null,
        resolvedAt: null,
        archivedAt: null,
        inertAt: null,
      },
    })
    .returning()
  return row && canonicalItem(row)
}

export async function upsertInboxItems(values: NewInboxItem[]): Promise<InboxItem[]> {
  if (values.length === 0) return []
  const db = getDb()
  return canonicalRows(db
    .insert(inboxItems)
    .values(values.map(storedItem))
    .onConflictDoUpdate({
      target: [inboxItems.recipientUserId, inboxItems.groupKey],
      set: {
        count: sql`${inboxItems.count} + excluded.count`,
        updatedAt: new Date(),
        actorUserId: sql`excluded.actor_user_id`,
        anchorId: sql`excluded.anchor_id`,
        payload: sql`${inboxItems.payload} || excluded.payload`,
        readAt: null,
        resolvedAt: null,
        archivedAt: null,
        inertAt: null,
      },
    })
    .returning())
}

export async function deleteOrphanedInboxItems(limit = 500): Promise<number> {
  const db = getDb()
  const orphans = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        or(
          and(
            eq(inboxItems.resourceType, 'conversation'),
            notExists(
              db.select({ one: sql`1` }).from(conversations).where(eq(conversations.id, inboxItems.resourceId)),
            ),
          ),
          and(
            eq(inboxItems.resourceType, 'document'),
            notExists(
              db.select({ one: sql`1` }).from(documents).where(sql`${documents.id}::text = ${inboxItems.resourceId}`),
            ),
          ),
        ),
      ),
    )
    .limit(limit)
  if (orphans.length === 0) return 0
  const rows = await db
    .delete(inboxItems)
    .where(
      inArray(
        inboxItems.id,
        orphans.map((row) => row.id),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function deleteItemsForResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<number> {
  const db = getDb()
  const rows = await db
    .delete(inboxItems)
    .where(and(eq(inboxItems.resourceType, resourceType), eq(inboxItems.resourceId, resourceId)))
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function pruneInboxItemsOlderThan(cutoff: Date, limit = 1000): Promise<number> {
  const db = getDb()
  const stale = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(lt(inboxItems.createdAt, cutoff))
    .limit(limit)
  if (stale.length === 0) return 0
  const rows = await db
    .delete(inboxItems)
    .where(
      inArray(
        inboxItems.id,
        stale.map((row) => row.id),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}
