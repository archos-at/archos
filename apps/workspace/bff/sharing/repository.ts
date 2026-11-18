import 'server-only'
import { and, desc, eq, inArray, notExists, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { conversations } from '@/lib/db/schema/conversations'
import { documents } from '@/lib/db/schema/documents'
import { resourceShares, type NewResourceShare, type ResourceRole, type ResourceShare, type ShareableResourceType } from '@/lib/db/schema/resource-shares'

export const SHARE_ROSTER_LIMIT = 200

export const SHARED_WITH_ME_LIMIT = 200

export async function findGrantForSubject(
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
): Promise<ResourceShare | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.resourceType, resourceType),
        eq(resourceShares.resourceId, resourceId),
        eq(resourceShares.subjectUserId, subjectUserId),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function listGrantsForResource(
  organizationId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
  limit = SHARE_ROSTER_LIMIT,
): Promise<ResourceShare[]> {
  const db = getDb()
  return db
    .select()
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.organizationId, organizationId),
        eq(resourceShares.resourceType, resourceType),
        eq(resourceShares.resourceId, resourceId),
      ),
    )
    .orderBy(desc(resourceShares.createdAt))
    .limit(limit)
}

export async function listGrantsForResources(
  organizationId: string,
  resourceType: ShareableResourceType,
  resourceIds: string[],
): Promise<ResourceShare[]> {
  if (resourceIds.length === 0) return []
  const db = getDb()
  return db
    .select()
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.organizationId, organizationId),
        eq(resourceShares.resourceType, resourceType),
        inArray(resourceShares.resourceId, resourceIds),
      ),
    )
    .limit(SHARE_ROSTER_LIMIT * 5)
}

export async function listResourceIdsSharedWith(
  organizationId: string,
  subjectUserId: string,
  resourceType: ShareableResourceType,
  limit = SHARED_WITH_ME_LIMIT,
): Promise<Array<{ resourceId: string; role: ResourceRole }>> {
  const db = getDb()
  const rows = await db
    .select({ resourceId: resourceShares.resourceId, role: resourceShares.role })
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.organizationId, organizationId),
        eq(resourceShares.subjectUserId, subjectUserId),
        eq(resourceShares.resourceType, resourceType),
      ),
    )
    .orderBy(desc(resourceShares.updatedAt))
    .limit(limit)
  return rows
}

export async function countGrantsForResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(resourceShares)
    .where(and(eq(resourceShares.resourceType, resourceType), eq(resourceShares.resourceId, resourceId)))
  return Number(row?.count ?? 0)
}

export async function upsertGrant(
  values: NewResourceShare,
  executor: DbExecutor = getDb(),
): Promise<ResourceShare> {
  const [row] = await executor
    .insert(resourceShares)
    .values(values)
    .onConflictDoUpdate({
      target: [resourceShares.resourceType, resourceShares.resourceId, resourceShares.subjectUserId],
      set: { role: values.role, grantedBy: values.grantedBy, updatedAt: new Date() },
    })
    .returning()
  return row
}

export async function deleteGrant(
  organizationId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
): Promise<boolean> {
  const db = getDb()
  const deleted = await db
    .delete(resourceShares)
    .where(
      and(
        eq(resourceShares.organizationId, organizationId),
        eq(resourceShares.resourceType, resourceType),
        eq(resourceShares.resourceId, resourceId),
        eq(resourceShares.subjectUserId, subjectUserId),
      ),
    )
    .returning({ id: resourceShares.id })
  return deleted.length > 0
}

export async function deleteOrphanedGrants(limit = 500): Promise<number> {
  const db = getDb()
  const orphans = await db
    .select({ id: resourceShares.id })
    .from(resourceShares)
    .where(
      and(
        or(
          and(
            eq(resourceShares.resourceType, 'conversation'),
            notExists(
              db
                .select({ one: sql`1` })
                .from(conversations)
                .where(eq(conversations.id, resourceShares.resourceId)),
            ),
          ),
          and(
            eq(resourceShares.resourceType, 'document'),
            notExists(
              db
                .select({ one: sql`1` })
                .from(documents)
                .where(sql`${documents.id}::text = ${resourceShares.resourceId}`),
            ),
          ),
        ),
      ),
    )
    .limit(limit)
  if (orphans.length === 0) return 0
  const rows = await db
    .delete(resourceShares)
    .where(
      inArray(
        resourceShares.id,
        orphans.map((row) => row.id),
      ),
    )
    .returning({ id: resourceShares.id })
  return rows.length
}

export async function deleteAllGrantsForResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<number> {
  const db = getDb()
  const deleted = await db
    .delete(resourceShares)
    .where(and(eq(resourceShares.resourceType, resourceType), eq(resourceShares.resourceId, resourceId)))
    .returning({ id: resourceShares.id })
  return deleted.length
}
