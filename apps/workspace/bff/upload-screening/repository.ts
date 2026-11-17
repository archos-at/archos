import 'server-only'
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentQuarantineDecisions, type DocumentQuarantineDecision } from '@/lib/db/schema/document-quarantine-decisions'
import { withTenant } from '@/lib/db/tenant-context'

export async function listOwedQuarantineDecisions(
  organizationId: string,
  documentIds: readonly string[]
): Promise<DocumentQuarantineDecision[]> {
  if (documentIds.length === 0) return []
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(documentQuarantineDecisions)
      .where(
        and(
          eq(documentQuarantineDecisions.organizationId, organizationId),
          inArray(documentQuarantineDecisions.documentId, [...documentIds]),
          isNull(documentQuarantineDecisions.auditedAt)
        )
      )
  )
}

export async function listOwedQuarantineDecisionsBetween(
  decidedAfter: Date,
  decidedBefore: Date,
  limit: number
): Promise<DocumentQuarantineDecision[]> {
  const db = getDb()
  return db
    .select()
    .from(documentQuarantineDecisions)
    .where(
      and(
        isNull(documentQuarantineDecisions.auditedAt),
        lt(documentQuarantineDecisions.decidedAt, decidedBefore),
        gt(documentQuarantineDecisions.decidedAt, decidedAfter)
      )
    )
    .orderBy(desc(documentQuarantineDecisions.decidedAt))
    .limit(limit)
}

export async function markQuarantineDecisionAudited(
  organizationId: string,
  decisionId: string,
  auditedAt: Date
): Promise<boolean> {
  const db = getDb()
  const marked = await withTenant({ organizationId }, () =>
    db
      .update(documentQuarantineDecisions)
      .set({ auditedAt })
      .where(
        and(
          eq(documentQuarantineDecisions.id, decisionId),
          eq(documentQuarantineDecisions.organizationId, organizationId),
          isNull(documentQuarantineDecisions.auditedAt)
        )
      )
      .returning({ id: documentQuarantineDecisions.id })
  )
  return marked.length > 0
}

export async function deleteSpentQuarantineDecisions(decidedBefore: Date, limit: number): Promise<number> {
  const db = getDb()
  const spent = db
    .select({ id: documentQuarantineDecisions.id })
    .from(documentQuarantineDecisions)
    .where(
      or(
        isNotNull(documentQuarantineDecisions.auditedAt),
        lt(documentQuarantineDecisions.decidedAt, decidedBefore)
      )
    )
    .limit(limit)
  const deleted = await db
    .delete(documentQuarantineDecisions)
    .where(inArray(documentQuarantineDecisions.id, spent))
    .returning({ id: documentQuarantineDecisions.id })
  return deleted.length
}
