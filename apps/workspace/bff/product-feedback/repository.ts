import 'server-only'
import { and, desc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { organizations } from '@/lib/db/schema/organizations'
import { productFeedback, type NewProductFeedback, type ProductFeedback, type ProductFeedbackKind } from '@/lib/db/schema/product-feedback'

export const PRODUCT_FEEDBACK_LIST_LIMIT = 50

export async function insertProductFeedback(values: NewProductFeedback): Promise<ProductFeedback> {
  const db = getDb()
  const [row] = await db.insert(productFeedback).values(values).returning()
  return row
}

export async function setProductFeedbackTicket(
  id: string,
  ticketId: string,
  widgetSessionId: string
): Promise<void> {
  const db = getDb()
  await db
    .update(productFeedback)
    .set({
      posthogTicketId: ticketId,
      posthogWidgetSessionId: widgetSessionId,
      reporterSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(productFeedback.id, id), isNull(productFeedback.posthogTicketId)))
}

export const OWN_PRODUCT_FEEDBACK_LIMIT = 20

export async function listOwnProductFeedback(
  organizationId: string,
  userId: string,
  page: { limit: number; before?: { createdAt: Date; id: string } }
): Promise<ProductFeedback[]> {
  const db = getDb()
  const clauses: SQL[] = [eq(productFeedback.organizationId, organizationId), eq(productFeedback.userId, userId)]
  if (page.before) {
    const { createdAt, id } = page.before
    const older = or(
      lt(productFeedback.createdAt, createdAt),
      and(eq(productFeedback.createdAt, createdAt), lt(productFeedback.id, id))
    )
    if (older) clauses.push(older)
  }
  return db
    .select()
    .from(productFeedback)
    .where(and(...clauses))
    .orderBy(desc(productFeedback.createdAt), desc(productFeedback.id))
    .limit(Math.min(page.limit, OWN_PRODUCT_FEEDBACK_LIMIT))
}

export async function listOrganizationProductFeedback(
  organizationId: string,
  page: { limit: number; before?: { createdAt: Date; id: string } }
): Promise<ProductFeedback[]> {
  const db = getDb()
  const clauses: SQL[] = [eq(productFeedback.organizationId, organizationId)]
  if (page.before) {
    const { createdAt, id } = page.before
    const older = or(
      lt(productFeedback.createdAt, createdAt),
      and(eq(productFeedback.createdAt, createdAt), lt(productFeedback.id, id))
    )
    if (older) clauses.push(older)
  }
  return db
    .select()
    .from(productFeedback)
    .where(and(...clauses))
    .orderBy(desc(productFeedback.createdAt), desc(productFeedback.id))
    .limit(Math.min(page.limit, OWN_PRODUCT_FEEDBACK_LIMIT))
}

export async function getOrganizationProductFeedback(
  organizationId: string,
  id: string
): Promise<ProductFeedback | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(productFeedback)
    .where(and(eq(productFeedback.id, id), eq(productFeedback.organizationId, organizationId)))
    .limit(1)
  return row ?? null
}

export async function getOwnProductFeedback(
  organizationId: string,
  userId: string,
  id: string
): Promise<ProductFeedback | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(productFeedback)
    .where(
      and(
        eq(productFeedback.id, id),
        eq(productFeedback.organizationId, organizationId),
        eq(productFeedback.userId, userId)
      )
    )
    .limit(1)
  return row ?? null
}

export async function markOwnProductFeedbackSeen(
  organizationId: string,
  userId: string,
  id: string,
  at: Date
): Promise<void> {
  const db = getDb()
  await db
    .update(productFeedback)
    .set({ reporterSeenAt: at })
    .where(
      and(
        eq(productFeedback.id, id),
        eq(productFeedback.organizationId, organizationId),
        eq(productFeedback.userId, userId)
      )
    )
}

export async function advanceReporterNotifiedAt(
  organizationId: string,
  id: string,
  to: Date
): Promise<boolean> {
  const db = getDb()
  const moved = await db
    .update(productFeedback)
    .set({ reporterNotifiedAt: to })
    .where(
      and(
        eq(productFeedback.id, id),
        eq(productFeedback.organizationId, organizationId),
        or(isNull(productFeedback.reporterNotifiedAt), lt(productFeedback.reporterNotifiedAt, to))
      )
    )
    .returning({ id: productFeedback.id })
  return moved.length > 0
}

export async function rewindReporterNotifiedAt(
  organizationId: string,
  id: string,
  from: Date,
  previous: Date | null
): Promise<void> {
  const db = getDb()
  await db
    .update(productFeedback)
    .set({ reporterNotifiedAt: previous })
    .where(
      and(
        eq(productFeedback.id, id),
        eq(productFeedback.organizationId, organizationId),
        eq(productFeedback.reporterNotifiedAt, from)
      )
    )
}

export interface ProductFeedbackRow extends ProductFeedback {
  organizationName: string | null
}

export interface ListProductFeedbackOptions {
  kind?: ProductFeedbackKind
  unticketed?: boolean
  since?: Date
  before?: { createdAt: Date; id: string }
  limit?: number
}

function listFilters(options: ListProductFeedbackOptions): SQL | undefined {
  const clauses: SQL[] = []
  if (options.kind) clauses.push(eq(productFeedback.kind, options.kind))
  if (options.unticketed) clauses.push(isNull(productFeedback.posthogTicketId))
  if (options.since) clauses.push(gte(productFeedback.createdAt, options.since))
  if (options.before) {
    const { createdAt, id } = options.before
    const older = or(
      lt(productFeedback.createdAt, createdAt),
      and(eq(productFeedback.createdAt, createdAt), lt(productFeedback.id, id))
    )
    if (older) clauses.push(older)
  }
  return clauses.length > 0 ? and(...clauses) : undefined
}

export async function listProductFeedback(
  options: ListProductFeedbackOptions = {}
): Promise<ProductFeedbackRow[]> {
  const db = getDb()
  const limit = Math.min(options.limit ?? PRODUCT_FEEDBACK_LIST_LIMIT, PRODUCT_FEEDBACK_LIST_LIMIT)
  const rows = await db
    .select({ report: productFeedback, organizationName: organizations.displayName })
    .from(productFeedback)
    .leftJoin(organizations, eq(organizations.workosOrganizationId, productFeedback.organizationId))
    .where(listFilters(options))
    .orderBy(desc(productFeedback.createdAt), desc(productFeedback.id))
    .limit(limit)
  return rows.map((row) => ({ ...row.report, organizationName: row.organizationName ?? null }))
}

export async function getProductFeedback(id: string): Promise<ProductFeedbackRow | null> {
  const db = getDb()
  const [row] = await db
    .select({ report: productFeedback, organizationName: organizations.displayName })
    .from(productFeedback)
    .leftJoin(organizations, eq(organizations.workosOrganizationId, productFeedback.organizationId))
    .where(eq(productFeedback.id, id))
    .limit(1)
  return row ? { ...row.report, organizationName: row.organizationName ?? null } : null
}

export async function findProductFeedbackByTicketId(ticketId: string): Promise<ProductFeedback | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(productFeedback)
    .where(eq(productFeedback.posthogTicketId, ticketId))
    .limit(1)
  return row ?? null
}

export async function getProductFeedbackByTicketIds(
  ticketIds: readonly string[]
): Promise<Map<string, ProductFeedbackRow>> {
  const ids = [...new Set(ticketIds)].slice(0, PRODUCT_FEEDBACK_LIST_LIMIT)
  if (ids.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select({ report: productFeedback, organizationName: organizations.displayName })
    .from(productFeedback)
    .leftJoin(organizations, eq(organizations.workosOrganizationId, productFeedback.organizationId))
    .where(inArray(productFeedback.posthogTicketId, ids))
    .limit(ids.length)
  return new Map(
    rows.map((row) => [
      row.report.posthogTicketId as string,
      { ...row.report, organizationName: row.organizationName ?? null },
    ])
  )
}
