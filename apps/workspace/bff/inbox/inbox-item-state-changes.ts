import 'server-only'
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboxItems, type InboxItemType } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { foldedOnItsAnchor, groupAnchorPattern, type InboxTypeScope, typeFilter } from './inbox-item-predicates'
import { storedInboxTypesOf } from './types'

const markReadValues = () => ({ readAt: new Date(), count: 0 })

export async function markInboxItemsRead(
  organizationId: string,
  recipientUserId: string,
  itemIds: string[],
  types: InboxTypeScope,
): Promise<number> {
  if (itemIds.length === 0) return 0
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set(markReadValues())
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        inArray(inboxItems.id, itemIds),
        isNull(inboxItems.readAt),
        typeFilter(types),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function markAllInboxItemsRead(
  organizationId: string,
  recipientUserId: string,
  types: InboxTypeScope,
): Promise<number> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set(markReadValues())
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        isNull(inboxItems.readAt),
        typeFilter(types),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function markInboxItemsUnread(
  organizationId: string,
  recipientUserId: string,
  itemIds: string[],
  types: InboxTypeScope,
): Promise<number> {
  if (itemIds.length === 0) return 0
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set({ readAt: null })
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        inArray(inboxItems.id, itemIds),
        isNotNull(inboxItems.readAt),
        isNull(inboxItems.archivedAt),
        isNull(inboxItems.inertAt),
        typeFilter(types),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function unarchiveInboxItem(
  organizationId: string,
  recipientUserId: string,
  itemId: string,
  types: InboxTypeScope,
): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set({ archivedAt: null })
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        eq(inboxItems.id, itemId),
        isNotNull(inboxItems.archivedAt),
        typeFilter(types),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length > 0
}

export async function archiveInboxItem(
  organizationId: string,
  recipientUserId: string,
  itemId: string,
  types: InboxTypeScope,
): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        eq(inboxItems.id, itemId),
        typeFilter(types),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length > 0
}

export async function markResourceItemsRead(
  organizationId: string,
  recipientUserId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
  only?: { groupAnchor: string; types: InboxTypeScope },
): Promise<number> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set(markReadValues())
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        eq(inboxItems.resourceType, resourceType),
        eq(inboxItems.resourceId, resourceId),
        eq(inboxItems.actionable, false),
        isNull(inboxItems.readAt),
        only ? sql`${inboxItems.groupKey} LIKE ${groupAnchorPattern(only.groupAnchor)}` : undefined,
        only ? typeFilter(only.types) : undefined,
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function markAnchorItemsRead(
  organizationId: string,
  recipientUserId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
  anchorId: string,
  types: InboxTypeScope,
): Promise<number> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set(markReadValues())
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        eq(inboxItems.resourceType, resourceType),
        eq(inboxItems.resourceId, resourceId),
        eq(inboxItems.anchorId, anchorId),
        eq(inboxItems.actionable, false),
        isNull(inboxItems.readAt),
        typeFilter(types),
        foldedOnItsAnchor(),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function archiveInboxItemsOfType(
  organizationId: string,
  type: InboxItemType,
  options: { exceptAnchorId?: string } = {},
): Promise<number> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        inArray(inboxItems.type, storedInboxTypesOf([type])),
        isNull(inboxItems.archivedAt),
        options.exceptAnchorId === undefined
          ? undefined
          : or(isNull(inboxItems.anchorId), ne(inboxItems.anchorId, options.exceptAnchorId)),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}
