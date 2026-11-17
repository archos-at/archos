import 'server-only'
import { and, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { documentAnnotations, pilotiWakes, type AgentWakeRow } from '@/lib/db/schema/document-annotations'
import { withTenant } from '@/lib/db/tenant-context'
import { AGENT_WAKE_LIFECYCLE } from './lifecycles'
import type { AgentWakeTrigger } from './types'

export interface NewWake {
  id: string
  organizationId: string
  documentId: string
  annotationId: string
  triggerKind: AgentWakeTrigger
  eventId: string
  actorUserId: string
  status: 'queued' | 'suppressed'
  reason?: string | null
}

export async function insertWake(executor: DbExecutor, wake: NewWake): Promise<boolean> {
  const settled = wake.status === 'suppressed'
  const now = new Date()
  const rows = await executor
    .insert(pilotiWakes)
    .values({
      ...wake,
      reason: settled ? (wake.reason ?? 'suppressed') : null,
      settledAt: settled ? now : null,
      endedAt: settled ? now : null,
    })
    .onConflictDoNothing()
    .returning({ id: pilotiWakes.id })
  return rows.length > 0
}

export async function countWakes(
  executor: DbExecutor,
  query: {
    organizationId: string
    since: Date
    annotationId?: string
    actorUserId?: string
    before?: { createdAt: Date; id: string }
  }
): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number | string>`count(*)` })
    .from(pilotiWakes)
    .where(
      and(
        eq(pilotiWakes.organizationId, query.organizationId),
        ne(pilotiWakes.status, 'suppressed'),
        gte(pilotiWakes.createdAt, query.since),
        query.annotationId ? eq(pilotiWakes.annotationId, query.annotationId) : undefined,
        query.actorUserId ? eq(pilotiWakes.actorUserId, query.actorUserId) : undefined,
        query.before ? lt(pilotiWakes.createdAt, query.before.createdAt) : undefined,
        query.before ? ne(pilotiWakes.id, query.before.id) : undefined
      )
    )
  return Number(row?.count ?? 0)
}

export async function findWake(organizationId: string, id: string): Promise<AgentWakeRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(pilotiWakes)
      .where(and(eq(pilotiWakes.organizationId, organizationId), eq(pilotiWakes.id, id)))
      .limit(1)
  )
  return row ?? null
}

export async function settleWake(
  organizationId: string,
  id: string,
  outcome: { status: 'started' } | { status: 'suppressed' | 'refused' | 'failed'; reason: string }
): Promise<boolean> {
  const db = getDb()
  const reason = 'reason' in outcome ? outcome.reason.slice(0, 500) : null
  const now = new Date()
  const rows = await withTenant({ organizationId }, () =>
    db
      .update(pilotiWakes)
      .set({ status: outcome.status, reason, settledAt: now, endedAt: outcome.status === 'started' ? null : now })
      .where(
        and(eq(pilotiWakes.organizationId, organizationId), eq(pilotiWakes.id, id), eq(pilotiWakes.status, 'queued'))
      )
      .returning({ id: pilotiWakes.id })
  )
  return rows.length > 0
}

export async function findWakeById(id: string): Promise<AgentWakeRow | null> {
  const db = getDb()
  const [row] = await db.select().from(pilotiWakes).where(eq(pilotiWakes.id, id)).limit(1)
  return row ?? null
}

export async function countWakesInTenant(
  organizationId: string,
  query: Omit<Parameters<typeof countWakes>[1], 'organizationId'>
): Promise<number> {
  const db = getDb()
  return withTenant({ organizationId }, () => countWakes(db, { ...query, organizationId }))
}

export type WakeEnd = { status: 'answered' | 'stopped' } | { status: 'failed'; reason: string }

export async function endWake(
  executor: DbExecutor,
  organizationId: string,
  id: string,
  end: WakeEnd
): Promise<AgentWakeRow | null> {
  const reason = end.status === 'failed' ? end.reason.slice(0, 500) : null
  const [row] = await executor
    .update(pilotiWakes)
    .set({ status: end.status, reason, endedAt: new Date(), settledAt: sql`COALESCE(${pilotiWakes.settledAt}, now())` })
    .where(
      and(
        eq(pilotiWakes.organizationId, organizationId),
        eq(pilotiWakes.id, id),
        inArray(pilotiWakes.status, [...AGENT_WAKE_LIFECYCLE.liveStates])
      )
    )
    .returning()
  return row ?? null
}

export async function findLiveDelegationWake(
  executor: DbExecutor,
  organizationId: string,
  annotationId: string,
  eventId: string
): Promise<AgentWakeRow | null> {
  const [row] = await executor
    .select()
    .from(pilotiWakes)
    .where(
      and(
        eq(pilotiWakes.organizationId, organizationId),
        eq(pilotiWakes.annotationId, annotationId),
        eq(pilotiWakes.triggerKind, 'assigned'),
        eq(pilotiWakes.eventId, eventId),
        inArray(pilotiWakes.status, [...AGENT_WAKE_LIFECYCLE.liveStates])
      )
    )
    .orderBy(desc(pilotiWakes.createdAt))
    .limit(1)
  return row ?? null
}

export async function handBackDelegation(
  executor: DbExecutor,
  organizationId: string,
  annotationId: string,
  delegatedAt: Date
): Promise<boolean> {
  const rows = await executor
    .update(documentAnnotations)
    .set({ delegatedBy: null, delegatedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(documentAnnotations.organizationId, organizationId),
        eq(documentAnnotations.id, annotationId),
        eq(documentAnnotations.delegatedAt, delegatedAt)
      )
    )
    .returning({ id: documentAnnotations.id })
  return rows.length > 0
}

export interface WakeSpanRow {
  annotationId: string
  actorUserId: string
  triggerKind: AgentWakeTrigger
  createdAt: Date
  endedAt: Date | null
}

export async function listAnsweringWakes(organizationId: string, documentId: string): Promise<WakeSpanRow[]> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select({
        annotationId: pilotiWakes.annotationId,
        actorUserId: pilotiWakes.actorUserId,
        triggerKind: pilotiWakes.triggerKind,
        createdAt: pilotiWakes.createdAt,
        endedAt: pilotiWakes.endedAt,
      })
      .from(pilotiWakes)
      .where(
        and(
          eq(pilotiWakes.organizationId, organizationId),
          eq(pilotiWakes.documentId, documentId),
          inArray(pilotiWakes.status, ['queued', 'started', 'answered', 'stopped'])
        )
      )
      .orderBy(desc(pilotiWakes.createdAt))
      .limit(MAX_WAKE_SPANS)
  )
}

const MAX_WAKE_SPANS = 2000

export async function listLatestWakes(
  organizationId: string,
  documentId: string,
  annotationId?: string
): Promise<AgentWakeRow[]> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .selectDistinctOn([pilotiWakes.annotationId])
      .from(pilotiWakes)
      .where(
        and(
          eq(pilotiWakes.organizationId, organizationId),
          eq(pilotiWakes.documentId, documentId),
          annotationId ? eq(pilotiWakes.annotationId, annotationId) : undefined
        )
      )
      .orderBy(pilotiWakes.annotationId, desc(pilotiWakes.createdAt))
      .limit(MAX_WAKE_SPANS)
  )
}
