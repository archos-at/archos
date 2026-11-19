import 'server-only'
import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { conversations } from '@/lib/db/schema/conversations'
import { inboxItems, type InboxItemType } from '@/lib/db/schema/inbox'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { groupAnchorPattern } from './inbox-item-predicates'
import { storedInboxTypesOf } from './types'

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
        inArray(inboxItems.type, storedInboxTypesOf(input.types)),
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

function anchoredRows(input: AnchoredRows) {
  const anchor = input.groupAnchor
  return and(
    eq(inboxItems.organizationId, input.organizationId),
    inArray(inboxItems.type, storedInboxTypesOf(input.types)),
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

export interface OpenGroupRefresh {
  organizationId: string
  groupKey: string
  recipientUserIds: readonly string[]
  anchorId: string | null
  count: number
  payload: Record<string, unknown>
}

export async function refreshOpenGroupItems(input: OpenGroupRefresh): Promise<string[]> {
  if (input.recipientUserIds.length === 0) return []
  const rows = await getDb()
    .update(inboxItems)
    .set({
      anchorId: input.anchorId,
      count: Math.max(1, Math.floor(input.count)),
      payload: sql`${inboxItems.payload} || ${JSON.stringify(input.payload)}::jsonb`,
    })
    .where(
      and(
        eq(inboxItems.organizationId, input.organizationId),
        eq(inboxItems.groupKey, input.groupKey),
        inArray(inboxItems.recipientUserId, [...input.recipientUserIds]),
        isNull(inboxItems.resolvedAt),
        isNull(inboxItems.archivedAt),
        isNull(inboxItems.inertAt),
      ),
    )
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
