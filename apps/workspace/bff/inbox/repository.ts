import 'server-only'
import { and, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lt, lte, ne, notExists, notInArray, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations } from '@/lib/db/schema/conversations'
import { documents } from '@/lib/db/schema/documents'
import { inboxItems, type InboxItem, type InboxItemType, type NewInboxItem } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { INBOX_LIST_LIMIT, legacyInboxTypeAliases, type InboxListFilter } from './types'
import { MARKS_SET_GROUP_ANCHOR } from './registry'

export { INBOX_LIST_LIMIT }

export async function upsertInboxItem(values: NewInboxItem): Promise<InboxItem> {
  const db = getDb()
  const [row] = await db
    .insert(inboxItems)
    .values(values)
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
  return row
}

export async function upsertInboxItems(values: NewInboxItem[]): Promise<InboxItem[]> {
  if (values.length === 0) return []
  const db = getDb()
  return db
    .insert(inboxItems)
    .values(values)
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
    .returning()
}

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
  return row ?? null
}

export async function listTouchedOfType(
  organizationId: string,
  recipientUserId: string,
  type: InboxItemType,
  window: { from: Date; to: Date },
  limit: number,
): Promise<InboxItem[]> {
  return getDb()
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        eq(inboxItems.type, type),
        gte(inboxItems.updatedAt, window.from),
        lte(inboxItems.updatedAt, window.to),
      ),
    )
    .orderBy(desc(inboxItems.updatedAt))
    .limit(limit)
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

export type { InboxListFilter }

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

export const EVERY_INBOX_TYPE = 'every-type' as const

export type InboxTypeScope = readonly InboxItemType[] | typeof EVERY_INBOX_TYPE

function typeFilter(types: InboxTypeScope | undefined) {
  if (!types || types === EVERY_INBOX_TYPE) return undefined
  if (types.length === 0) return sql`false`
  return inArray(inboxItems.type, [...types, ...legacyInboxTypeAliases(types)] as InboxItemType[])
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
  return db
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
    .limit(limit)
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

const foldedOnItsAnchor = () => sql`${inboxItems.groupKey} NOT LIKE ${groupAnchorPattern(MARKS_SET_GROUP_ANCHOR)}`

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

export interface InboxResolutionTarget {
  organizationId: string
  recipientUserId: string
  groupKey: string
}

export async function resolveInboxItemsForTargets(
  targets: readonly InboxResolutionTarget[],
): Promise<number> {
  if (targets.length === 0) return 0
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        isNull(inboxItems.resolvedAt),
        or(
          ...targets.map((target) =>
            and(
              eq(inboxItems.organizationId, target.organizationId),
              eq(inboxItems.recipientUserId, target.recipientUserId),
              eq(inboxItems.groupKey, target.groupKey),
            ),
          ),
        ),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function resolveOpenItemsAnchoredOn(input: {
  organizationId: string
  types: readonly InboxItemType[]
  anchorId: string
  recipientUserId?: string
}): Promise<string[]> {
  if (input.types.length === 0) return []
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(inboxItems.organizationId, input.organizationId),
        inArray(inboxItems.type, [...input.types]),
        eq(inboxItems.anchorId, input.anchorId),
        isNull(inboxItems.resolvedAt),
        input.recipientUserId ? eq(inboxItems.recipientUserId, input.recipientUserId) : undefined,
      ),
    )
    .returning({ recipientUserId: inboxItems.recipientUserId })
  return [...new Set(rows.map((row) => row.recipientUserId))]
}

export interface AnchoredRows {
  organizationId: string
  types: readonly InboxItemType[]
  anchorId: string
  recipientUserId?: string
  exceptRecipients?: readonly string[]
  payloadHas?: Record<string, string>
  groupAnchor?: { is: string } | { isNot: string }
}

const groupAnchorPattern = (prefix: string): string => `%:${prefix.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

function anchoredRows(input: AnchoredRows) {
  const anchor = input.groupAnchor
  return and(
    eq(inboxItems.organizationId, input.organizationId),
    inArray(inboxItems.type, [...input.types]),
    eq(inboxItems.anchorId, input.anchorId),
    isNull(inboxItems.inertAt),
    input.recipientUserId ? eq(inboxItems.recipientUserId, input.recipientUserId) : undefined,
    input.exceptRecipients?.length ? notInArray(inboxItems.recipientUserId, [...input.exceptRecipients]) : undefined,
    input.payloadHas ? sql`${inboxItems.payload} @> ${JSON.stringify(input.payloadHas)}::jsonb` : undefined,
    anchor && 'is' in anchor ? sql`${inboxItems.groupKey} LIKE ${groupAnchorPattern(anchor.is)}` : undefined,
    anchor && 'isNot' in anchor ? sql`${inboxItems.groupKey} NOT LIKE ${groupAnchorPattern(anchor.isNot)}` : undefined,
  )
}

const inertValues = () => ({ inertAt: new Date(), payload: {}, count: 0 })

export async function markItemsInertAnchoredOn(input: AnchoredRows): Promise<string[]> {
  if (input.types.length === 0) return []
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set(inertValues())
    .where(anchoredRows(input))
    .returning({ recipientUserId: inboxItems.recipientUserId })
  return [...new Set(rows.map((row) => row.recipientUserId))]
}

export async function retractOccurrenceAnchoredOn(
  input: AnchoredRows & { clear: readonly string[]; inertWhenSpent: boolean },
): Promise<string[]> {
  if (input.types.length === 0) return []
  const db = getDb()
  const spent = input.inertWhenSpent ? sql`${inboxItems.count} <= 1` : sql`false`
  const cleared = input.clear.reduce((payload, key) => sql`${payload} - ${key}::text`, sql`${inboxItems.payload}`)
  const rows = await db
    .update(inboxItems)
    .set({
      count: sql`greatest(${inboxItems.count} - 1, 0)`,
      payload: sql`CASE WHEN ${spent} THEN '{}'::jsonb ELSE ${cleared} END`,
      inertAt: sql`CASE WHEN ${spent} THEN now() ELSE NULL END`,
    })
    .where(anchoredRows(input))
    .returning({ recipientUserId: inboxItems.recipientUserId })
  return [...new Set(rows.map((row) => row.recipientUserId))]
}

export async function rewriteItemPayloadsAnchoredOn(
  input: AnchoredRows & { facts: Record<string, unknown> },
): Promise<string[]> {
  if (input.types.length === 0) return []
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set({ payload: sql`${inboxItems.payload} || ${JSON.stringify(input.facts)}::jsonb` })
    .where(anchoredRows(input))
    .returning({ recipientUserId: inboxItems.recipientUserId })
  return [...new Set(rows.map((row) => row.recipientUserId))]
}

export async function markItemsInertForSubjectRow(
  resourceType: ShareableResourceType,
  resourceId: string,
  recipientUserId: string,
): Promise<number> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set(inertValues())
    .where(
      and(
        eq(inboxItems.resourceType, resourceType),
        eq(inboxItems.resourceId, resourceId),
        eq(inboxItems.recipientUserId, recipientUserId),
        isNull(inboxItems.inertAt),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function markItemsInertForResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<number> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set(inertValues())
    .where(
      and(
        eq(inboxItems.resourceType, resourceType),
        eq(inboxItems.resourceId, resourceId),
        isNull(inboxItems.inertAt),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
}

export async function markItemsInertForSubjectInProject(
  organizationId: string,
  projectId: string,
  recipientUserId: string,
): Promise<number> {
  const db = getDb()
  const rows = await db
    .update(inboxItems)
    .set(inertValues())
    .where(
      and(
        eq(inboxItems.organizationId, organizationId),
        eq(inboxItems.recipientUserId, recipientUserId),
        eq(inboxItems.resourceType, 'conversation'),
        isNull(inboxItems.inertAt),
        inArray(
          inboxItems.resourceId,
          db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(eq(conversations.organizationId, organizationId), eq(conversations.projectId, projectId)),
            ),
        ),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
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
        eq(inboxItems.type, type),
        isNull(inboxItems.archivedAt),
        options.exceptAnchorId === undefined
          ? undefined
          : or(isNull(inboxItems.anchorId), ne(inboxItems.anchorId, options.exceptAnchorId)),
      ),
    )
    .returning({ id: inboxItems.id })
  return rows.length
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
  return rows.map((row) => row.type)
}
