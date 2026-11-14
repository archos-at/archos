/**
 * SQL of the sweeps over mail threads (ADR-0137, DECISION §5): threads whose
 * document is gone (sweep 9) and follows that end or are about to (sweep 12).
 *
 * The rules every statement here keeps (discovery, per-row writes, deletes,
 * and legal hold as a filter) are `./sweep-repository.ts`'s, the module its
 * callers import.
 */

import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { mailThreadFollows } from '@/lib/db/schema/mail-thread'
import { MAIL_THREAD_FOLLOW_EXPIRING_NOTICE_DAYS } from './inbound-mail-vocabulary'
import { DAY_MS, select } from './sweep-sql'

// ---------------------------------------------------------------------------
// Sweep 9: threads whose document is gone
// ---------------------------------------------------------------------------

/** How long a thread without a document is left alone: one being written gets its document in the same commit. */
export const ORPHANED_THREAD_AFTER_MS = 60 * 60 * 1000
/**
 * How long an archive Verlauf may wait for its first Fassung (`render_pending_at`)
 * once no import that wrote into it is open any more: past the import's stall
 * horizon and its backoff ladder, an import whose starter left never renders it.
 */
export const ABANDONED_RENDER_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * A thread may be deleted now (`t` is `mail_threads`): its document is gone
 * (deleted for good, so it is not in a bin either: a binned document keeps its
 * row), no archive slice is about to render it (an archive Verlauf waits for
 * its first Fassung with `render_pending_at`; one whose import is no longer
 * open and that waited a day is abandoned, D11), no writer holds its lease, no
 * hold covers its project, no follow of it is still running (sweep 12 ends
 * them first, audited), and no decision a follow of it made, nor any other
 * decision about a part such a decision filed, is still owed to the trail (the
 * cascade from its follows would take them along, RT-S8).
 */
const threadDeletable = (now: Date, leaseHolder: string | null = null) => sql`
  t.document_id IS NULL
  AND (t.render_pending_at IS NULL
       OR (t.render_pending_at < ${new Date(now.getTime() - ABANDONED_RENDER_AFTER_MS).toISOString()}::timestamptz
           AND NOT EXISTS (
             SELECT 1 FROM mail_thread_entries e JOIN mail_imports i ON i.id = e.mail_import_id
              WHERE e.thread_id = t.id AND i.status IN ('uploading', 'queued', 'importing'))))
  AND ${
    leaseHolder === null
      ? sql`(t.render_lease_until IS NULL OR t.render_lease_until < ${now.toISOString()}::timestamptz)`
      : sql`t.render_lease_holder = ${leaseHolder}::uuid`
  }
  AND NOT legal_hold_blocks('project', t.project_id::text, t.organization_id)
  AND NOT EXISTS (SELECT 1 FROM mail_thread_follows f WHERE f.thread_id = t.id AND f.ended_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM mail_thread_follows f
      JOIN inbound_mail_decisions d ON d.follow_id = f.id
      JOIN inbound_mail_decisions owed ON owed.part_id = d.part_id
     WHERE f.thread_id = t.id AND owed.audited_at IS NULL)`

/** A thread to delete, and the originals its entries keep. */
export interface OrphanedThread {
  id: string
  organizationId: string
  originals: Array<{ bucket: string; key: string }>
}

/** Threads whose document is gone, past the grace, that may be deleted now. Platform scope. */
export async function findOrphanedThreads(now: Date, limit: number): Promise<OrphanedThread[]> {
  const before = new Date(now.getTime() - ORPHANED_THREAD_AFTER_MS).toISOString()
  const rows = await select<{ id: string; organizationId: string; originals: Array<{ bucket: string; key: string }> | null }>(sql`
    SELECT t.id, t.organization_id AS "organizationId",
           (SELECT json_agg(json_build_object('bucket', e.original_bucket, 'key', e.original_storage_key))
              FROM mail_thread_entries e
             WHERE e.thread_id = t.id AND e.original_storage_key IS NOT NULL) AS originals
      FROM mail_threads t
     WHERE t.created_at < ${before}::timestamptz AND ${threadDeletable(now)}
     ORDER BY t.created_at
     LIMIT ${limit}`)
  return rows.map((row) => ({ ...row, originals: row.originals ?? [] }))
}

/** How long sweep 9 holds a thread's render lease while it erases the originals: a writer's own lease. */
const ORPHANED_THREAD_LEASE_MS = 5 * 60 * 1000

/**
 * Sweep 9, before any erasure, as the platform role: the thread's render
 * lease, taken only while the whole condition holds (the legal hold
 * included), so no append lands while its originals go and a hold placed
 * after the find erases nothing. The originals to erase are read here, under
 * the lease, not from the find; null when it was not taken.
 */
export async function claimOrphanedThread(
  id: string,
  holder: string,
  now: Date,
): Promise<Array<{ bucket: string; key: string }> | null> {
  const until = new Date(now.getTime() + ORPHANED_THREAD_LEASE_MS).toISOString()
  const rows = await select<{ originals: Array<{ bucket: string; key: string }> | null }>(sql`
    UPDATE mail_threads t SET render_lease_holder = ${holder}::uuid, render_lease_until = ${until}::timestamptz
     WHERE t.id = ${id}::uuid AND ${threadDeletable(now)}
    RETURNING (SELECT json_agg(json_build_object('bucket', e.original_bucket, 'key', e.original_storage_key))
                 FROM mail_thread_entries e
                WHERE e.thread_id = t.id AND e.original_storage_key IS NOT NULL) AS originals`)
  const [row] = rows
  return row ? (row.originals ?? []) : null
}

/** Sweep 9 could not erase an original: the lease goes, and the next run asks again. */
export async function releaseOrphanedThread(id: string, holder: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE mail_threads SET render_lease_holder = NULL, render_lease_until = NULL
     WHERE id = ${id}::uuid AND render_lease_holder = ${holder}::uuid`)
}

/**
 * Delete a thread whose originals were erased (sweep 9), as the platform role,
 * under the lease `claimOrphanedThread` took: the cascade takes its entries,
 * what came with them, its message ids, its ended follows and their audited
 * decisions. Repeats the whole condition; the number of entries it took, or
 * null when it was not deleted.
 */
export async function deleteOrphanedThread(id: string, holder: string, now: Date): Promise<number | null> {
  const rows = await select<{ entries: number | string }>(sql`
    WITH gone AS (
      DELETE FROM mail_threads t WHERE t.id = ${id}::uuid AND ${threadDeletable(now, holder)} RETURNING t.id)
    SELECT (SELECT count(*) FROM mail_thread_entries e WHERE e.thread_id IN (SELECT id FROM gone)) AS entries,
           (SELECT count(*) FROM gone) AS deleted`)
  const [row] = rows as Array<{ entries: number | string; deleted: number | string }>
  return row && Number(row.deleted) === 1 ? Number(row.entries) : null
}

// ---------------------------------------------------------------------------
// Sweep 12: follows
// ---------------------------------------------------------------------------

/** A running follow due to end, or to be asked to renew. */
export interface DueFollow {
  id: string
  organizationId: string
  projectId: string
  threadId: string
  userId: string
  threadDocumentId: string | null
}

const followFacts = sql`f.id, f.organization_id AS "organizationId", f.project_id AS "projectId",
  f.thread_id AS "threadId", f.user_id AS "userId", t.document_id AS "threadDocumentId"`

/** Why sweep 12 ends a running follow. */
export type FollowEndingReason = 'expired' | 'document_gone' | 'project_closed'

/**
 * Running follows past their end, whose thread's document is gone, or in a
 * closed project (closing ends them, `endFollowsOnProjectClose`; this catches
 * a close whose ending failed after it committed). Platform scope.
 */
export async function findEndingFollows(now: Date, limit: number): Promise<Array<DueFollow & { reason: FollowEndingReason }>> {
  return select<DueFollow & { reason: FollowEndingReason }>(sql`
    SELECT ${followFacts},
           CASE WHEN t.document_id IS NULL THEN 'document_gone'
                WHEN p.status = 'closed' THEN 'project_closed'
                ELSE 'expired' END AS reason
      FROM mail_thread_follows f
      JOIN mail_threads t ON t.id = f.thread_id
      JOIN projects p ON p.id = f.project_id
     WHERE f.ended_at IS NULL
       AND (f.expires_at < ${now.toISOString()}::timestamptz OR t.document_id IS NULL OR p.status = 'closed')
     ORDER BY f.expires_at
     LIMIT ${limit}`)
}

/** How long before its end a follower is asked to renew: day 55 of 60 (D31). */
export const FOLLOW_EXPIRING_BEFORE_MS = MAIL_THREAD_FOLLOW_EXPIRING_NOTICE_DAYS * DAY_MS

/** Running follows within five days of their end, not asked yet, on a live thread. Platform scope. */
export async function findExpiringFollows(now: Date, limit: number): Promise<DueFollow[]> {
  const from = new Date(now.getTime() + FOLLOW_EXPIRING_BEFORE_MS).toISOString()
  return select<DueFollow>(sql`
    SELECT ${followFacts}
      FROM mail_thread_follows f
      JOIN mail_threads t ON t.id = f.thread_id
     WHERE f.ended_at IS NULL AND f.expiring_notified_at IS NULL AND t.document_id IS NOT NULL
       AND f.expires_at <= ${from}::timestamptz AND f.expires_at > ${now.toISOString()}::timestamptz
     ORDER BY f.expires_at
     LIMIT ${limit}`)
}

/** Mark a follow asked to renew, once: whether this call marked it (the caller then asks). */
export async function claimFollowExpiringNotice(followId: string, now: Date): Promise<boolean> {
  const rows = await getDb()
    .update(mailThreadFollows)
    .set({ expiringNotifiedAt: now })
    .where(and(eq(mailThreadFollows.id, followId), isNull(mailThreadFollows.endedAt), isNull(mailThreadFollows.expiringNotifiedAt)))
    .returning({ id: mailThreadFollows.id })
  return rows.length === 1
}
