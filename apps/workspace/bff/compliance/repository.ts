import 'server-only'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { deletionQueue, type DeletionEntityType } from '@/lib/db/schema/deletion-queue'
import { legalHolds, type LegalHold, type NewLegalHold } from '@/lib/db/schema/legal-holds'

export const COMPLIANCE_LIST_LIMIT = 200

export async function listOpenHoldsInOrg(
  organizationId: string,
  limit = COMPLIANCE_LIST_LIMIT,
): Promise<LegalHold[]> {
  const db = getDb()
  return db
    .select()
    .from(legalHolds)
    .where(and(eq(legalHolds.organizationId, organizationId), isNull(legalHolds.releasedAt)))
    .orderBy(desc(legalHolds.createdAt))
    .limit(limit)
}

export async function isCoveredByActiveHold(
  organizationId: string,
  entityType: DeletionEntityType,
  entityId: string,
): Promise<boolean> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db.execute<{ held: boolean }>(
      sql`select legal_hold_blocks(${entityType}, ${entityId}, ${organizationId}) as held`,
    ),
  )
  return Array.from(rows)[0]?.held === true
}

export async function insertHold(
  values: Pick<NewLegalHold, 'entityType' | 'entityId' | 'reason' | 'organizationId' | 'createdBy'>,
): Promise<LegalHold> {
  const db = getDb()
  const [row] = await db.insert(legalHolds).values(values).returning()
  return row
}

export async function releaseHoldInOrg(holdId: string, organizationId: string): Promise<LegalHold | null> {
  const db = getDb()
  const [row] = await db
    .update(legalHolds)
    .set({ releasedAt: new Date() })
    .where(
      and(
        eq(legalHolds.id, holdId),
        eq(legalHolds.organizationId, organizationId),
        isNull(legalHolds.releasedAt),
      ),
    )
    .returning()
  return row ?? null
}

export interface DeletionQueueSummary {
  id: string
  entityType: (typeof deletionQueue.$inferSelect)['entityType']
  entityId: string
  displayName: string
  requestedBy: string
  requestedAt: Date
  purgeAfter: Date
  status: (typeof deletionQueue.$inferSelect)['status']
  lastError: string | null
}

export async function listPendingDeletionsInOrg(
  organizationId: string,
  limit = COMPLIANCE_LIST_LIMIT,
): Promise<DeletionQueueSummary[]> {
  const db = getDb()
  return db
    .select({
      id: deletionQueue.id,
      entityType: deletionQueue.entityType,
      entityId: deletionQueue.entityId,
      displayName: deletionQueue.displayName,
      requestedBy: deletionQueue.requestedBy,
      requestedAt: deletionQueue.requestedAt,
      purgeAfter: deletionQueue.purgeAfter,
      status: deletionQueue.status,
      lastError: deletionQueue.lastError,
    })
    .from(deletionQueue)
    .where(
      and(
        eq(deletionQueue.organizationId, organizationId),
        inArray(deletionQueue.status, ['pending', 'failed']),
      ),
    )
    .orderBy(desc(deletionQueue.requestedAt))
    .limit(limit)
}
