import 'server-only'
import { and, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations } from '@/lib/db/schema/conversations'
import { documents } from '@/lib/db/schema/documents'
import { inboxItems, type InboxItem, type InboxItemType } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { canonicalItem, canonicalRows } from './canonical-rows'
import { foldedOnItsAnchor, type InboxTypeScope, typeFilter } from './inbox-item-predicates'
import { canonicalInboxType, INBOX_LIST_LIMIT, storedInboxTypesOf, type InboxListFilter } from './types'

export async function findInboxItemForRecipient(
  organizationId: string,
  recipientUserId: string,
  itemId: string,
): Promise<InboxItem | null> {
  const [row] = await getDb()
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, itemId),
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
      ),
    )
    .limit(1)
  return row ? canonicalItem(row) : null
}

export async function listTouchedOfType(
  organizationId: string,
  recipientUserId: string,
  type: InboxItemType,
  window: { from: Date; to: Date },
  limit: number,
): Promise<InboxItem[]> {
  return canonicalRows(getDb()
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        inArray(inboxItems.type, storedInboxTypesOf([type])),
        gte(inboxItems.updatedAt, window.from),
        lte(inboxItems.updatedAt, window.to),
      ),
    )
    .orderBy(desc(inboxItems.updatedAt))
    .limit(limit))
}

export async function recipientsHoldingGroup(
  organizationId: string,
  groupKey: string,
  recipientUserIds: readonly string[],
): Promise<Set<string>> {
  if (recipientUserIds.length === 0) return new Set()
  const db = getDb()
  const rows = await db
    .select({ recipientUserId: inboxItems.recipientUserId })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.groupKey, groupKey),
        inArray(inboxItems.recipientUserId, [...recipientUserIds]),
      ),
    )
  return new Set(rows.map((row) => row.recipientUserId))
}

export async function readGroupPayloads(
  organizationId: string,
  targets: readonly { recipientUserId: string; groupKey: string }[],
): Promise<Map<string, Record<string, unknown>>> {
  if (targets.length === 0) return new Map()
  const rows = await getDb()
    .select({ recipientUserId: inboxItems.recipientUserId, groupKey: inboxItems.groupKey, payload: inboxItems.payload })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        or(
          ...targets.map((target) =>
            and(eq(inboxItems.recipientUserId, target.recipientUserId), eq(inboxItems.groupKey, target.groupKey)),
          ),
        ),
      ),
    )
    .limit(targets.length)
  return new Map(rows.map((row) => [`${row.recipientUserId}\n${row.groupKey}`, row.payload ?? {}]))
}

export async function openRecipientsOfGroup(
  organizationId: string,
  groupKey: string,
  limit = 50,
): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ recipientUserId: inboxItems.recipientUserId })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.groupKey, groupKey),
        isNull(inboxItems.resolvedAt),
        isNull(inboxItems.inertAt),
      ),
    )
    .orderBy(inboxItems.createdAt)
    .limit(limit)
  return rows.map((row) => row.recipientUserId)
}

export interface InboxCursor {
  micros: string
  id: string
}

export type ListedInboxItem = InboxItem & { listedAtMicros?: string }

export interface ListInboxOptions {
  filter?: InboxListFilter
  cursor?: InboxCursor | null
  limit?: number
  projectId?: string
  types: InboxTypeScope
}

const listedAtMicros = sql<string>`(extract(epoch from ${inboxItems.updatedAt}) * 1000000)::bigint::text`

function filterPredicate(filter: InboxListFilter) {
  switch (filter) {
    case 'pending':
      return and(isNull(inboxItems.archivedAt), pendingPredicate())
    case 'requests':
      return and(isNull(inboxItems.archivedAt), openRequestPredicate())
    case 'unread':
      return and(isNull(inboxItems.archivedAt), unreadPredicate())
    case 'archived':
      return isNotNull(inboxItems.archivedAt)
    case 'all':
      return isNull(inboxItems.archivedAt)
  }
}

function projectScopePredicate(organizationId: string, projectId: string) {
  return or(
    and(eq(inboxItems.resourceType, 'project'), eq(inboxItems.resourceId, projectId)),
    and(
      eq(inboxItems.resourceType, 'conversation'),
      sql`exists (select 1 from ${conversations} where ${conversations.id} = ${inboxItems.resourceId} and ${conversations.projectId} = ${projectId} and ${conversations.organizationId} = ${organizationId})`,
    ),
    and(
      eq(inboxItems.resourceType, 'document'),
      sql`exists (select 1 from ${documents} where ${documents.id}::text = ${inboxItems.resourceId} and ${documents.projectId} = ${projectId} and ${documents.organizationId} = ${organizationId})`,
    ),
  )
}

export async function listInboxItems(
  organizationId: string,
  recipientUserId: string,
  options: ListInboxOptions,
): Promise<ListedInboxItem[]> {
  const { filter = 'all', cursor = null, limit = INBOX_LIST_LIMIT, types, projectId } = options
  const db = getDb()
  return canonicalRows(db
    .select({ ...getTableColumns(inboxItems), listedAtMicros })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        filterPredicate(filter),
        typeFilter(types),
        projectId ? projectScopePredicate(organizationId, projectId) : undefined,
        cursor
          ? sql`(${inboxItems.updatedAt}, ${inboxItems.id}) < (timestamptz 'epoch' + ${cursor.micros}::bigint * interval '1 microsecond', ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(inboxItems.updatedAt), desc(inboxItems.id))
    .limit(limit))
}

function openRequestPredicate() {
  return and(isNull(inboxItems.inertAt), eq(inboxItems.actionable, true), isNull(inboxItems.resolvedAt))
}

function unreadPredicate() {
  return and(isNull(inboxItems.inertAt), isNull(inboxItems.readAt))
}

function pendingPredicate() {
  return and(
    isNull(inboxItems.inertAt),
    or(isNull(inboxItems.readAt), and(eq(inboxItems.actionable, true), isNull(inboxItems.resolvedAt))),
  )
}

export async function countPendingInboxItems(
  organizationId: string,
  recipientUserId: string,
  types: InboxTypeScope,
): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        isNull(inboxItems.archivedAt),
        pendingPredicate(),
        typeFilter(types),
      ),
    )
  return Number(row?.count ?? 0)
}

export interface InboxFilterCounts {
  requests: number
  unread: number
}

export async function countInboxFilters(
  organizationId: string,
  recipientUserId: string,
  types: InboxTypeScope,
): Promise<InboxFilterCounts> {
  const db = getDb()
  const [row] = await db
    .select({
      requests: sql<number>`count(*) filter (where ${openRequestPredicate()})`,
      unread: sql<number>`count(*) filter (where ${unreadPredicate()})`,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        isNull(inboxItems.archivedAt),
        pendingPredicate(),
        typeFilter(types),
      ),
    )
  return { requests: Number(row?.requests ?? 0), unread: Number(row?.unread ?? 0) }
}

export const UNREAD_ANCHORS_LIMIT = 500

export async function listUnreadAnchors(
  organizationId: string,
  recipientUserId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
  types: InboxTypeScope,
): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .selectDistinct({ anchorId: inboxItems.anchorId })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        eq(inboxItems.resourceType, resourceType),
        eq(inboxItems.resourceId, resourceId),
        isNotNull(inboxItems.anchorId),
        eq(inboxItems.actionable, false),
        isNull(inboxItems.readAt),
        isNull(inboxItems.archivedAt),
        isNull(inboxItems.inertAt),
        typeFilter(types),
        foldedOnItsAnchor(),
      ),
    )
    .limit(UNREAD_ANCHORS_LIMIT)
  return rows.flatMap((row) => (row.anchorId ? [row.anchorId] : []))
}

export async function findLiveInboxGroupKeys(
  organizationId: string,
  targets: readonly { recipientUserId: string; groupKey: string }[],
): Promise<Set<string>> {
  if (targets.length === 0) return new Set()
  const db = getDb()
  const rows = await db
    .select({ recipientUserId: inboxItems.recipientUserId, groupKey: inboxItems.groupKey })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        isNull(inboxItems.archivedAt),
        or(
          ...targets.map((target) =>
            and(
              eq(inboxItems.recipientUserId, target.recipientUserId),
              eq(inboxItems.groupKey, target.groupKey),
            ),
          ),
        ),
      ),
    )
  return new Set(rows.map((row) => `${row.recipientUserId}\n${row.groupKey}`))
}

export async function listInboxTypesForRecipient(
  organizationId: string,
  recipientUserId: string,
): Promise<InboxItemType[]> {
  const db = getDb()
  const rows = await db
    .selectDistinct({ type: inboxItems.type })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        isNull(inboxItems.archivedAt),
      ),
    )
  return rows.map((row) => canonicalInboxType(row.type) as InboxItemType)
}
