/**
 * SQL of the sweeps that erase (ADR-0137, DECISION §5): a part's bytes past
 * their restore window and the mail they settle (sweep 6), rows past their keep
 * (sweep 8), and erasures a hold deferred, once it is released (sweep 10).
 *
 * The rules every statement here keeps (discovery, per-row writes, deletes,
 * and legal hold as a filter) are `./sweep-repository.ts`'s, the module its
 * callers import.
 */

import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboundMailParts, inboundMails, type InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { ignoredCounts } from './filing-repository'
import { DAY_MS, mailErasable, select } from './sweep-sql'

// ---------------------------------------------------------------------------
// Sweep 6: dismissed and expired parts past their seven days; settling
// ---------------------------------------------------------------------------

/** How long a dismissed or expired part can be restored (D8). */
export const RESTORE_WINDOW_MS = 7 * DAY_MS

/**
 * A dismissed or expired part is past restoring: seven days after it ended,
 * or at once for a dismissed part of mail from an unconfirmed outside domain
 * (D8: nobody vouched for it, and somebody said no).
 */
const pastRestore = (cutoff: Date) => sql`(p.ended_at < ${cutoff.toISOString()}::timestamptz
  OR (p.state = 'dismissed' AND m.sender_trust = 'external_unverified'))`

/** A staged object to erase, and whether a hold defers that. */
export interface EndedPartBytes {
  partId: string
  mailId: string
  organizationId: string
  stagingBucket: string
  storageKey: string
  held: boolean
}

/** Dismissed or expired parts past restoring that still hold bytes, not deferred yet. Platform scope. */
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

/**
 * Sweep 6, before the erasure: the part forgets its bytes' key (and the name
 * and suggestion that go with them) only while every condition of the find
 * still holds: still dismissed or expired, past restoring, the same key, no
 * deferral, no hold. True when it did; the caller erases the object only then,
 * so a restore or a hold that landed after the find erases nothing.
 */
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

/** The store could not erase what `takeEndedPartBytes` took: the key comes back, so the next run tries again. */
export async function returnEndedPartKey(part: { partId: string; storageKey: string }, now: Date): Promise<void> {
  await getDb()
    .update(inboundMailParts)
    .set({ storageKey: part.storageKey, updatedAt: now })
    .where(and(eq(inboundMailParts.id, part.partId), isNull(inboundMailParts.storageKey), endedOrFiled))
}

/** A hold stopped the erasure of a part's bytes: sweep 10 erases them once it is released. */
export async function deferPartErasure(partId: string, now: Date): Promise<void> {
  await getDb()
    .update(inboundMailParts)
    .set({ erasureDeferredAt: now, updatedAt: now })
    .where(and(eq(inboundMailParts.id, partId), endedOrFiled, isNull(inboundMailParts.erasureDeferredAt)))
}

/** A held mail nothing of which can be decided or restored any more: settled and scrubbed next. */
export interface MailToSettle {
  id: string
  organizationId: string
  projectId: string
  held: boolean
}

/**
 * `waiting` mail with no part waiting or being filed, and none still
 * restorable (sweep 6). Includes mail every part of which was filed but whose
 * settle did not run. Platform scope.
 */
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

/** The row as the settle reads it. */
export async function findMailRow(mailId: string): Promise<InboundMailRow | null> {
  const [row] = await getDb().select().from(inboundMails).where(eq(inboundMails.id, mailId)).limit(1)
  return row ?? null
}

/**
 * Settle a mail nothing of which waits or can be restored: scrubbed to ids
 * (`inbound_mails_ended_is_scrubbed`), its staged objects forgotten (the
 * caller erased them by key first), unless a hold deferred the erasure, which
 * keeps the keys for sweep 10. A raw message still moving to its entry's
 * original is the move's (sweep 13). Only from `waiting`, and only while
 * nothing waits or is being filed; whether this call settled it.
 */
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

// ---------------------------------------------------------------------------
// Sweep 8: rows past their keep
// ---------------------------------------------------------------------------

/** How long a settled mail's ids are kept once none of its files lives, and a dropped mail's (D8). */
export const SETTLED_KEEP_MS = 30 * DAY_MS
export const DROPPED_KEEP_MS = 30 * DAY_MS

/**
 * Settled and dropped mail past its keep that may be deleted now (`m` is
 * `inbound_mails`): a settled mail only once no filed part names a live
 * document, any mail only once it names no object, none of its decisions is
 * still owed to the audit trail (RT-S8; sweep 11 runs first), and no hold
 * covers its project or its member.
 */
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

/** Settled and dropped mail past its keep (sweep 8). Platform scope. */
export async function findKeptMails(now: Date, limit: number): Promise<Array<{ id: string; organizationId: string }>> {
  return select<{ id: string; organizationId: string }>(sql`
    SELECT m.id, m.organization_id AS "organizationId" FROM inbound_mails m
     WHERE ${mailDeletable(now)}
     ORDER BY coalesce(m.settled_at, m.received_at)
     LIMIT ${limit}`)
}

/**
 * Delete these mails, as the platform role (sweep 8), each only if it still
 * may be: its parts and its (audited) decisions go with it. The ids deleted.
 */
export async function deleteKeptMails(ids: readonly string[], now: Date): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await select<{ id: string }>(sql`
    DELETE FROM inbound_mails m
     WHERE m.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND ${mailDeletable(now)}
    RETURNING m.id`)
  return rows.map((row) => row.id)
}

// ---------------------------------------------------------------------------
// Sweep 10: erasures a hold deferred, once it is released
// ---------------------------------------------------------------------------

/**
 * A deferred erasure no hold stops any more: a part's bytes (`storageKey`), or
 * an ended mail's staged objects (`readKey`, and `rawKey` unless the raw
 * message is still moving to its entry's original, sweep 13). The keys as the
 * find saw them; `keys` is what is to be erased.
 */
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

/** The raw message sweep 10 erases: none while it is still moving to its entry's original (sweep 13). */
const erasableRawKey = sql`CASE WHEN m.original_move_pending_at IS NULL THEN m.raw_storage_key END`

/** Deferred erasures whose hold was released. Platform scope. */
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

/**
 * Sweep 10, before the erasure: the row forgets the keys and the deferral only
 * while every condition of the find still holds: still deferred, still ended,
 * the same keys, and no hold (project or custodian). True when it did; the
 * caller erases the objects only then, so a hold placed after the find erases
 * nothing. A part also forgets the name and suggestion that went with its
 * bytes; a raw message still moving to its entry's original stays the move's.
 */
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

/**
 * The store kept some of what `takeReleasedErasure` took: those keys, and the
 * deferral, come back, so the next run tries again. A key the store did
 * erase stays forgotten.
 */
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
