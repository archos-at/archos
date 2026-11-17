import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { mailThreadFollows } from '@/lib/db/schema/mail-thread'
import { MAIL_THREAD_FOLLOW_EXPIRING_NOTICE_DAYS } from './inbound-mail-vocabulary'
import { DAY_MS, select } from './sweep-sql'

export const ORPHANED_THREAD_AFTER_MS = 60 * 60 * 1000
export const ABANDONED_RENDER_AFTER_MS = 24 * 60 * 60 * 1000

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

export interface OrphanedThread {
  id: string
  organizationId: string
  originals: Array<{ bucket: string; key: string }>
}

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

const ORPHANED_THREAD_LEASE_MS = 5 * 60 * 1000

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

export async function releaseOrphanedThread(id: string, holder: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE mail_threads SET render_lease_holder = NULL, render_lease_until = NULL
     WHERE id = ${id}::uuid AND render_lease_holder = ${holder}::uuid`)
}

export async function deleteOrphanedThread(id: string, holder: string, now: Date): Promise<number | null> {
  const rows = await select<{ entries: number | string }>(sql`
    WITH gone AS (
      DELETE FROM mail_threads t WHERE t.id = ${id}::uuid AND ${threadDeletable(now, holder)} RETURNING t.id)
    SELECT (SELECT count(*) FROM mail_thread_entries e WHERE e.thread_id IN (SELECT id FROM gone)) AS entries,
           (SELECT count(*) FROM gone) AS deleted`)
  const [row] = rows as Array<{ entries: number | string; deleted: number | string }>
  return row && Number(row.deleted) === 1 ? Number(row.entries) : null
}

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

export type FollowEndingReason = 'expired' | 'document_gone' | 'project_closed'

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

export const FOLLOW_EXPIRING_BEFORE_MS = MAIL_THREAD_FOLLOW_EXPIRING_NOTICE_DAYS * DAY_MS

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

export async function claimFollowExpiringNotice(followId: string, now: Date): Promise<boolean> {
  const rows = await getDb()
    .update(mailThreadFollows)
    .set({ expiringNotifiedAt: now })
    .where(and(eq(mailThreadFollows.id, followId), isNull(mailThreadFollows.endedAt), isNull(mailThreadFollows.expiringNotifiedAt)))
    .returning({ id: mailThreadFollows.id })
  return rows.length === 1
}
