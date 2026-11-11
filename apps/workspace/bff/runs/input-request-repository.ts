/**
 * Run input requests repository: the SQL over `run_input_requests` (migration
 * 0234, ADR-0181). No authorization here; `./input-requests` owns it. Every
 * statement is keyed by the organization and the run as well as the id, and
 * runs in its tenant scope.
 *
 * Every move is a compare-and-swap on the states the lifecycle allows it from,
 * so of two people (or two tabs) settling one request only one wins: the
 * loser's update finds no row.
 */

import 'server-only'
import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { CURSOR_TIMESTAMP_FORMAT, type DocumentListCursor } from '@/lib/documents/list-cursor'
import { getDb } from '@/lib/db'
import { runInputRequests, type RunInputRequest } from '@/lib/db/schema/run-input-requests'
import { withTenant } from '@/lib/db/tenant-context'
import {
  INPUT_REQUEST_LIFECYCLE,
  type InputContent,
  type InputRequestReason,
  type RequestedSchema,
} from './input-request-types'

export type { RunInputRequest }

/** Which run a statement is about, in whose organization. */
export interface RunKey {
  organizationId: string
  runId: string
}

export interface NewInputRequest extends RunKey {
  projectId: string
  idempotencyKey: string
  reason: InputRequestReason
  message: string
  requestedSchema: RequestedSchema
  expiresAt: Date | null
}

const ofRun = ({ organizationId, runId }: RunKey) =>
  and(eq(runInputRequests.organizationId, organizationId), eq(runInputRequests.runId, runId))

const openStates = () => inArray(runInputRequests.status, [...INPUT_REQUEST_LIFECYCLE.liveStates])

/**
 * Store a question. Idempotent on the run and the worker's key: a retried post
 * inserts nothing and returns the first request, as it stands.
 */
export async function insertOrFind(input: NewInputRequest): Promise<{ row: RunInputRequest; created: boolean }> {
  const db = getDb()
  return withTenant({ organizationId: input.organizationId }, async () => {
    const [inserted] = await db
      .insert(runInputRequests)
      .values(input)
      .onConflictDoNothing({ target: [runInputRequests.runId, runInputRequests.idempotencyKey] })
      .returning()
    if (inserted) return { row: inserted, created: true }
    const [existing] = await db
      .select()
      .from(runInputRequests)
      .where(and(ofRun(input), eq(runInputRequests.idempotencyKey, input.idempotencyKey)))
      .limit(1)
    return { row: existing, created: false }
  })
}

export async function countOpen(key: RunKey): Promise<number> {
  const db = getDb()
  const [row] = await withTenant({ organizationId: key.organizationId }, () =>
    db
      .select({ open: sql<number>`count(*)` })
      .from(runInputRequests)
      .where(and(ofRun(key), openStates()))
  )
  return Number(row?.open ?? 0)
}

/** A page of a run's requests, and the position of its last row when another page follows. */
export interface InputRequestPage {
  rows: RunInputRequest[]
  next: DocumentListCursor | null
}

/**
 * One keyset page of a run's requests in `created_at DESC, id DESC` order. The
 * cursor's time is the column's own microsecond text
 * (`lib/documents/list-cursor.ts` says why a JS `Date` would skip rows).
 */
export async function listForRun(key: RunKey, options: { limit: number; cursor: DocumentListCursor | null }): Promise<InputRequestPage> {
  const db = getDb()
  const { cursor, limit } = options
  const after = cursor
    ? sql`(${runInputRequests.createdAt}, ${runInputRequests.id}) < ((${cursor.createdAt})::timestamp AT TIME ZONE 'UTC', ${cursor.id}::uuid)`
    : undefined
  const fetched = await withTenant({ organizationId: key.organizationId }, () =>
    db
      .select({
        row: runInputRequests,
        cursorAt: sql<string>`to_char(${runInputRequests.createdAt} AT TIME ZONE 'UTC', ${CURSOR_TIMESTAMP_FORMAT})`,
      })
      .from(runInputRequests)
      .where(and(ofRun(key), after))
      .orderBy(desc(runInputRequests.createdAt), desc(runInputRequests.id))
      .limit(limit + 1)
  )
  const page = fetched.slice(0, limit)
  const last = page.at(-1)
  return {
    rows: page.map((entry) => entry.row),
    next: fetched.length > limit && last ? { createdAt: String(last.cursorAt), id: last.row.id } : null,
  }
}

export async function findInRun(key: RunKey, requestId: string): Promise<RunInputRequest | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId: key.organizationId }, () =>
    db
      .select()
      .from(runInputRequests)
      .where(and(ofRun(key), eq(runInputRequests.id, requestId)))
      .limit(1)
  )
  return row ?? null
}

/**
 * A person settles one request: `answered` with its content, or `declined`.
 * Null when it is no longer open, or never was this run's.
 */
export async function decide(
  key: RunKey,
  requestId: string,
  decision: { event: 'answer'; content: InputContent } | { event: 'decline' },
  decidedBy: string,
  at: Date
): Promise<RunInputRequest | null> {
  const db = getDb()
  const status = decision.event === 'answer' ? 'answered' : 'declined'
  const [row] = await withTenant({ organizationId: key.organizationId }, () =>
    db
      .update(runInputRequests)
      .set({ status, content: decision.event === 'answer' ? decision.content : null, decidedBy, decidedAt: at })
      .where(
        and(
          ofRun(key),
          eq(runInputRequests.id, requestId),
          inArray(runInputRequests.status, [...INPUT_REQUEST_LIFECYCLE.sourcesOf(decision.event)])
        )
      )
      .returning()
  )
  return row ?? null
}

/** Close every open request of the run whose deadline has passed. Answers how many it closed. */
export async function expireDue(key: RunKey, at: Date): Promise<number> {
  const db = getDb()
  const rows = await withTenant({ organizationId: key.organizationId }, () =>
    db
      .update(runInputRequests)
      .set({ status: 'expired', decidedAt: at })
      .where(
        and(
          ofRun(key),
          inArray(runInputRequests.status, [...INPUT_REQUEST_LIFECYCLE.sourcesOf('expire')]),
          isNotNull(runInputRequests.expiresAt),
          lte(runInputRequests.expiresAt, at)
        )
      )
      .returning({ id: runInputRequests.id })
  )
  return rows.length
}

/** Close every open request of a run that has ended: nobody is left to read the answer. */
export async function cancelOpen(key: RunKey, at: Date): Promise<number> {
  const db = getDb()
  const rows = await withTenant({ organizationId: key.organizationId }, () =>
    db
      .update(runInputRequests)
      .set({ status: 'cancelled', decidedAt: at })
      .where(and(ofRun(key), inArray(runInputRequests.status, [...INPUT_REQUEST_LIFECYCLE.sourcesOf('cancel')])))
      .returning({ id: runInputRequests.id })
  )
  return rows.length
}
