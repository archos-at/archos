import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboundMailParts, inboundMails, type InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { ignoredCounts } from './filing-repository'
import { DAY_MS, mailErasable, select } from './sweep-sql'

export const RESTORE_WINDOW_MS = 7 * DAY_MS

const pastRestore = (cutoff: Date) => sql`(p.ended_at < ${cutoff.toISOString()}::timestamptz
  OR (p.state = 'dismissed' AND m.sender_trust = 'external_unverified' AND NOT ('sender_unchecked' = ANY (m.sender_flags)))
  OR (p.state = 'expired' AND m.sender_class = 'external' AND NOT ('sender_unchecked' = ANY (m.sender_flags))))`

export interface EndedPartBytes {
  partId: string
  mailId: string
  organizationId: string
  stagingBucket: string
  storageKey: string
  held: boolean
}

export async function findEndedPartBytes(now: Date, limit: number): Promise<EndedPartBytes[]> {
  return select<EndedPartBytes>(sql`
    SELECT p.id AS "partId", p.mail_id AS "mailId", p.organization_id AS "organizationId",
           m.staging_bucket AS "stagingBucket", p.storage_key AS "storageKey", NOT (${mailErasable}) AS held
      FROM inbound_mail_parts p
      JOIN inbound_mails m ON m.id = p.mail_id
     WHERE p.state IN ('dismissed', 'expired') AND p.storage_key IS NOT NULL AND p.erasure_deferred_at IS NULL
       AND ${pastRestore(new Date(now.getTime() - RESTORE_WINDOW_MS))}
     ORDER BY p.ended_at
     LIMIT ${limit}`)
}

const endedOrFiled = inArray(inboundMailParts.state, ['dismissed', 'expired', 'filed'])

export async function takeEndedPartBytes(part: { partId: string; storageKey: string }, now: Date): Promise<boolean> {
  const rows = await select<{ id: string }>(sql`
    UPDATE inbound_mail_parts p
       SET storage_key = NULL, filename = NULL, suggestion = NULL, suggestion_trace_id = NULL, updated_at = ${now.toISOString()}::timestamptz
      FROM inbound_mails m
     WHERE p.id = ${part.partId}::uuid AND m.id = p.mail_id
       AND p.state IN ('dismissed', 'expired') AND p.storage_key = ${part.storageKey} AND p.erasure_deferred_at IS NULL
       AND ${pastRestore(new Date(now.getTime() - RESTORE_WINDOW_MS))}
       AND ${mailErasable}
    RETURNING p.id`)
  return rows.length === 1
}

export async function returnEndedPartKey(part: { partId: string; storageKey: string }, now: Date): Promise<void> {
  await getDb()
    .update(inboundMailParts)
    .set({ storageKey: part.storageKey, updatedAt: now })
    .where(and(eq(inboundMailParts.id, part.partId), isNull(inboundMailParts.storageKey), endedOrFiled))
}

export async function deferPartErasure(partId: string, now: Date): Promise<void> {
  await getDb()
    .update(inboundMailParts)
    .set({ erasureDeferredAt: now, updatedAt: now })
    .where(and(eq(inboundMailParts.id, partId), endedOrFiled, isNull(inboundMailParts.erasureDeferredAt)))
}

export interface MailToSettle {
  id: string
  organizationId: string
  projectId: string
  held: boolean
}

export async function findMailsToSettle(now: Date, limit: number): Promise<MailToSettle[]> {
  const cutoff = new Date(now.getTime() - RESTORE_WINDOW_MS)
  return select<MailToSettle>(sql`
    SELECT m.id, m.organization_id AS "organizationId", m.project_id AS "projectId", NOT (${mailErasable}) AS held
      FROM inbound_mails m
     WHERE m.status = 'waiting'
       AND EXISTS (SELECT 1 FROM inbound_mail_parts p WHERE p.mail_id = m.id)
       AND NOT EXISTS (
         SELECT 1 FROM inbound_mail_parts p
          WHERE p.mail_id = m.id
            AND (p.state IN ('waiting', 'filing')
                 OR (p.state IN ('dismissed', 'expired') AND NOT ${pastRestore(cutoff)})))
     ORDER BY m.updated_at
     LIMIT ${limit}`)
}

export async function findMailRow(mailId: string): Promise<InboundMailRow | null> {
  const [row] = await getDb().select().from(inboundMails).where(eq(inboundMails.id, mailId)).limit(1)
  return row ?? null
}

export async function settleEndedMail(mail: InboundMailRow, erasureDeferred: boolean, now: Date): Promise<boolean> {
  const rows = await getDb()
    .update(inboundMails)
    .set({
      status: 'settled',
      settledAt: now,
      senderAddress: null,
      senderName: null,
      subject: null,
      baseSubject: null,
      envelopeFrom: null,
      participants: [],
      participantDomains: [],
      notStaged: [],
      ignored: ignoredCounts(mail.notStaged, mail.ignored),
      ...(erasureDeferred
        ? { erasureDeferredAt: now }
        : { readStorageKey: null, ...(mail.originalMovePendingAt ? {} : { rawStorageKey: null }) }),
      updatedAt: now,
    })
    .where(
      and(
        eq(inboundMails.id, mail.id),
        eq(inboundMails.status, 'waiting'),
        sql`NOT EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id} AND p.state IN ('waiting', 'filing'))`,
      ),
    )
    .returning({ id: inboundMails.id })
  return rows.length === 1
}

export const SETTLED_KEEP_MS = 30 * DAY_MS
export const DROPPED_KEEP_MS = 30 * DAY_MS

const mailDeletable = (now: Date) => {
  const settledBefore = new Date(now.getTime() - SETTLED_KEEP_MS).toISOString()
  const droppedBefore = new Date(now.getTime() - DROPPED_KEEP_MS).toISOString()
  return sql`((m.status = 'settled' AND m.settled_at < ${settledBefore}::timestamptz
               AND NOT EXISTS (SELECT 1 FROM inbound_mail_parts p WHERE p.mail_id = m.id AND p.document_id IS NOT NULL))
           OR (m.status = 'dropped' AND m.received_at < ${droppedBefore}::timestamptz))
    AND m.raw_storage_key IS NULL AND m.read_storage_key IS NULL
    AND m.erasure_deferred_at IS NULL AND m.original_move_pending_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM inbound_mail_parts p WHERE p.mail_id = m.id AND p.storage_key IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM inbound_mail_decisions d WHERE d.mail_id = m.id AND d.audited_at IS NULL)
    AND ${mailErasable}`
}

export async function findKeptMails(now: Date, limit: number): Promise<Array<{ id: string; organizationId: string }>> {
  return select<{ id: string; organizationId: string }>(sql`
    SELECT m.id, m.organization_id AS "organizationId" FROM inbound_mails m
     WHERE ${mailDeletable(now)}
     ORDER BY coalesce(m.settled_at, m.received_at)
     LIMIT ${limit}`)
}

export async function deleteKeptMails(ids: readonly string[], now: Date): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await select<{ id: string }>(sql`
    DELETE FROM inbound_mails m
     WHERE m.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND ${mailDeletable(now)}
    RETURNING m.id`)
  return rows.map((row) => row.id)
}

export interface DeferredErasure {
  id: string
  kind: 'part' | 'mail'
  organizationId: string
  stagingBucket: string
  storageKey: string | null
  readKey: string | null
  rawKey: string | null
  keys: string[]
}

const erasableRawKey = sql`CASE WHEN m.original_move_pending_at IS NULL THEN m.raw_storage_key END`

export async function findReleasedErasures(limit: number): Promise<DeferredErasure[]> {
  const rows = await select<Omit<DeferredErasure, 'keys'>>(sql`
    (SELECT p.id, 'part' AS kind, p.organization_id AS "organizationId", m.staging_bucket AS "stagingBucket",
            p.storage_key AS "storageKey", NULL::text AS "readKey", NULL::text AS "rawKey"
       FROM inbound_mail_parts p
       JOIN inbound_mails m ON m.id = p.mail_id
      WHERE p.erasure_deferred_at IS NOT NULL AND p.state IN ('filed', 'dismissed', 'expired') AND ${mailErasable}
      ORDER BY p.erasure_deferred_at
      LIMIT ${limit})
    UNION ALL
    (SELECT m.id, 'mail' AS kind, m.organization_id AS "organizationId", m.staging_bucket AS "stagingBucket",
            NULL::text AS "storageKey", m.read_storage_key AS "readKey", ${erasableRawKey} AS "rawKey"
       FROM inbound_mails m
      WHERE m.erasure_deferred_at IS NOT NULL AND m.status IN ('settled', 'dropped') AND ${mailErasable}
      ORDER BY m.erasure_deferred_at
      LIMIT ${limit})`)
  return rows.map((row) => ({
    ...row,
    keys: [row.storageKey, row.readKey, row.rawKey].filter((key): key is string => key !== null),
  }))
}

export async function takeReleasedErasure(row: DeferredErasure, now: Date): Promise<boolean> {
  const at = now.toISOString()
  const rows = await select<{ id: string }>(
    row.kind === 'part'
      ? sql`
    UPDATE inbound_mail_parts p
       SET storage_key = NULL, filename = NULL, suggestion = NULL, suggestion_trace_id = NULL,
           erasure_deferred_at = NULL, updated_at = ${at}::timestamptz
      FROM inbound_mails m
     WHERE p.id = ${row.id}::uuid AND m.id = p.mail_id
       AND p.erasure_deferred_at IS NOT NULL AND p.state IN ('filed', 'dismissed', 'expired')
       AND p.storage_key IS NOT DISTINCT FROM ${row.storageKey}::text
       AND ${mailErasable}
    RETURNING p.id`
      : sql`
    UPDATE inbound_mails m
       SET read_storage_key = NULL, raw_storage_key = CASE WHEN m.original_move_pending_at IS NULL THEN NULL ELSE m.raw_storage_key END,
           erasure_deferred_at = NULL, updated_at = ${at}::timestamptz
     WHERE m.id = ${row.id}::uuid
       AND m.erasure_deferred_at IS NOT NULL AND m.status IN ('settled', 'dropped')
       AND m.read_storage_key IS NOT DISTINCT FROM ${row.readKey}::text
       AND ${erasableRawKey} IS NOT DISTINCT FROM ${row.rawKey}::text
       AND ${mailErasable}
    RETURNING m.id`,
  )
  return rows.length === 1
}

export async function returnReleasedErasure(row: DeferredErasure, kept: readonly string[], now: Date): Promise<void> {
  const keptKey = (key: string | null) => (key !== null && kept.includes(key) ? key : null)
  if (row.kind === 'part') {
    await getDb()
      .update(inboundMailParts)
      .set({ storageKey: keptKey(row.storageKey), erasureDeferredAt: now, updatedAt: now })
      .where(and(eq(inboundMailParts.id, row.id), isNull(inboundMailParts.storageKey), isNull(inboundMailParts.erasureDeferredAt), endedOrFiled))
    return
  }
  await getDb()
    .update(inboundMails)
    .set({
      readStorageKey: keptKey(row.readKey),
      rawStorageKey: sql`COALESCE(${inboundMails.rawStorageKey}, ${keptKey(row.rawKey)}::text)`,
      erasureDeferredAt: now,
      updatedAt: now,
    })
    .where(and(eq(inboundMails.id, row.id), isNull(inboundMails.erasureDeferredAt), inArray(inboundMails.status, ['settled', 'dropped'])))
}
