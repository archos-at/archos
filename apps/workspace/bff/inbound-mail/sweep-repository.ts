/**
 * SQL of the E-Mail-Eingang's retention sweeps (ADR-0137, DECISION §5, `./sweep.ts`).
 *
 * Three kinds of statement, each named by its scope:
 *
 * - **Discovery** (`find…`) lists what is due across every organization. Its
 *   caller runs it under `withPlatformAccess`, and it returns ids, keys and
 *   flags, never a sender, subject or file name. Every list is bounded.
 * - **Per-row writes** run in the row's own tenant scope (`withTenant`), each a
 *   compare-and-set on the state discovery saw, so a person or a job that
 *   moved the row in between wins and the sweep changes nothing.
 * - **Deletes** (`delete…`) run as the platform role, because DELETE is revoked
 *   from the runtime role on these tables (migration 0193, „Ending is a
 *   state“). Each repeats its whole condition, the legal hold included.
 *
 * **Legal hold is a filter, the trigger the backstop (RT-S20).** Every set
 * that erases or deletes asks `legal_hold_blocks` in its WHERE: a hold on
 * the project (`project`), and for a mail's bytes also a custodian hold on the
 * member it came from (`user`, `sender_user_id`). A held row is left out of
 * the set, or its erasure is deferred (`erasure_deferred_at`), so one held
 * project never makes a batch fail for every tenant; the triggers
 * (`GLH01`) still refuse whatever a later change forgets to filter.
 *
 * Callers import every statement from here. The erasing sweeps (6, 8 and 10)
 * live in `./sweep-erasure-repository.ts`, the thread and follow sweeps (9 and
 * 12) in `./sweep-thread-repository.ts`, and the hold filters all of them share
 * in `./sweep-sql.ts`.
 */

import 'server-only'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboundMailAddresses, inboundMailDecisions, inboundMailParts, inboundMails, type InboundMailDecisionRow } from '@/lib/db/schema/inbound-mail'
import type {
  InboundMailCapNotice,
  InboundMailContentFinding,
  InboundMailSenderClass,
  InboundSenderTrust,
  PartRiskFlag,
  SenderFlag,
} from './inbound-mail-vocabulary'
import type { StoredScan } from './repository'
import { DAY_MS, mailProjectFree, select } from './sweep-sql'

export {
  deferPartErasure,
  type DeferredErasure,
  deleteKeptMails,
  DROPPED_KEEP_MS,
  type EndedPartBytes,
  findEndedPartBytes,
  findKeptMails,
  findMailRow,
  findMailsToSettle,
  findReleasedErasures,
  type MailToSettle,
  RESTORE_WINDOW_MS,
  returnEndedPartKey,
  returnReleasedErasure,
  SETTLED_KEEP_MS,
  settleEndedMail,
  takeEndedPartBytes,
  takeReleasedErasure,
} from './sweep-erasure-repository'
export {
  ABANDONED_RENDER_AFTER_MS,
  claimFollowExpiringNotice,
  claimOrphanedThread,
  deleteOrphanedThread,
  type DueFollow,
  findEndingFollows,
  findExpiringFollows,
  findOrphanedThreads,
  FOLLOW_EXPIRING_BEFORE_MS,
  type FollowEndingReason,
  ORPHANED_THREAD_AFTER_MS,
  type OrphanedThread,
  releaseOrphanedThread,
} from './sweep-thread-repository'

// ---------------------------------------------------------------------------
// Sweep 1: receptions that never finished
// ---------------------------------------------------------------------------

/** A reception older than its window: its object (when one was written) and the row go. */
export interface StaleReception {
  id: string
  organizationId: string
  stagingBucket: string
  rawStorageKey: string | null
}

/** `receiving` rows not touched since `before`, outside any held project. Platform scope. */
export async function findStaleReceptions(before: Date, limit: number): Promise<StaleReception[]> {
  return select<StaleReception>(sql`
    SELECT m.id, m.organization_id AS "organizationId", m.staging_bucket AS "stagingBucket",
           m.raw_storage_key AS "rawStorageKey"
      FROM inbound_mails m
     WHERE m.status = 'receiving' AND m.updated_at < ${before.toISOString()}::timestamptz
       AND ${mailProjectFree}
     ORDER BY m.updated_at
     LIMIT ${limit}`)
}

/** Delete a stale reception whose object is gone. Platform scope; whether it was deleted. */
export async function deleteStaleReception(id: string, before: Date): Promise<boolean> {
  const rows = await select<{ id: string }>(sql`
    DELETE FROM inbound_mails m
     WHERE m.id = ${id}::uuid AND m.status = 'receiving' AND m.updated_at < ${before.toISOString()}::timestamptz
       AND ${mailProjectFree}
    RETURNING m.id`)
  return rows.length === 1
}

// ---------------------------------------------------------------------------
// Sweep 2: received mail whose job is gone
// ---------------------------------------------------------------------------

/** A received mail with no job reading it; `deadJob` when its job gave up and is still on the queue. */
export interface OrphanedReception {
  id: string
  organizationId: string
  projectId: string
  deadJob: boolean
}

/**
 * `received` rows not touched since `before` whose job (its id is the mail's)
 * is gone or dead. A dead job keeps its id until the queue's retention prunes
 * it, and only then can the same id be queued again. Platform scope.
 */
export async function findReceivedWithoutJob(before: Date, limit: number): Promise<OrphanedReception[]> {
  return select<OrphanedReception>(sql`
    SELECT m.id, m.organization_id AS "organizationId", m.project_id AS "projectId",
           (j.status = 'dead') AS "deadJob"
      FROM inbound_mails m
      LEFT JOIN bff_job_queue j ON j.job_id = m.id
     WHERE m.status = 'received' AND m.updated_at < ${before.toISOString()}::timestamptz
       AND (j.job_id IS NULL OR j.status = 'dead')
     ORDER BY m.updated_at
     LIMIT ${limit}`)
}

// ---------------------------------------------------------------------------
// Sweeps 3 and 4: the window runs out
// ---------------------------------------------------------------------------

/** What a notice or the trail reads of a held mail: ids and labels only. */
export interface HeldMailFacts {
  id: string
  organizationId: string
  projectId: string
  senderTrust: InboundSenderTrust
  senderUserId: string | null
  senderFlags: SenderFlag[]
  automatic: boolean
}

const heldFacts = sql`m.id, m.organization_id AS "organizationId", m.project_id AS "projectId",
  m.sender_trust AS "senderTrust", m.sender_user_id AS "senderUserId", m.sender_flags AS "senderFlags",
  m.automatic`

const hasWaitingPart = sql`EXISTS (SELECT 1 FROM inbound_mail_parts p WHERE p.mail_id = m.id AND p.state = 'waiting')`

/** Held mail past its window with a part still waiting (sweep 3). Platform scope. */
export async function findExpiredMails(now: Date, limit: number): Promise<HeldMailFacts[]> {
  return select<HeldMailFacts>(sql`
    SELECT ${heldFacts} FROM inbound_mails m
     WHERE m.status = 'waiting' AND m.expires_at < ${now.toISOString()}::timestamptz AND ${hasWaitingPart}
     ORDER BY m.expires_at
     LIMIT ${limit}`)
}

/**
 * Expire what still waits of one mail (sweep 3): each waiting part `expired`,
 * restorable for seven days from now (D8). A part being filed is its job's.
 * Only while the window is still out (a restore may have moved it). The
 * number of parts expired.
 */
export async function expireMail(mailId: string, now: Date): Promise<number> {
  return getDb().transaction(async (tx) => {
    const [mail] = await tx
      .select({ id: inboundMails.id })
      .from(inboundMails)
      .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'waiting'), lt(inboundMails.expiresAt, now)))
      .for('update')
      .limit(1)
    if (!mail) return 0
    const expired = await tx
      .update(inboundMailParts)
      .set({ state: 'expired', endedAt: now, updatedAt: now })
      .where(and(eq(inboundMailParts.mailId, mailId), eq(inboundMailParts.state, 'waiting')))
      .returning({ id: inboundMailParts.id })
    if (expired.length > 0) await tx.update(inboundMails).set({ updatedAt: now }).where(eq(inboundMails.id, mailId))
    return expired.length
  })
}

/** How long before its end a held mail's people are told it expires: day 25 of 30 (D8). */
export const EXPIRING_NOTICE_BEFORE_MS = 5 * DAY_MS

/** Held mail within five days of its end, not told yet, with a part still waiting (sweep 4). Platform scope. */
export async function findExpiringMails(now: Date, limit: number): Promise<HeldMailFacts[]> {
  const from = new Date(now.getTime() + EXPIRING_NOTICE_BEFORE_MS)
  return select<HeldMailFacts>(sql`
    SELECT ${heldFacts} FROM inbound_mails m
     WHERE m.status = 'waiting' AND m.expiring_notified_at IS NULL AND m.sender_trust IS NOT NULL
       AND m.expires_at <= ${from.toISOString()}::timestamptz AND m.expires_at > ${now.toISOString()}::timestamptz
       AND ${hasWaitingPart}
     ORDER BY m.expires_at
     LIMIT ${limit}`)
}

/** Mark a mail told it expires, once: whether this call marked it (the caller then tells). */
export async function claimExpiringNotice(mailId: string, now: Date): Promise<boolean> {
  const rows = await getDb()
    .update(inboundMails)
    .set({ expiringNotifiedAt: now })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'waiting'), isNull(inboundMails.expiringNotifiedAt)))
    .returning({ id: inboundMails.id })
  return rows.length === 1
}

// ---------------------------------------------------------------------------
// Sweep 5: filing claims that ran out
// ---------------------------------------------------------------------------

/** A part whose filing claim ran out, with the person whose filing it was. */
export interface LapsedClaim {
  partId: string
  decisionId: string
  mailId: string
  organizationId: string
  projectId: string
  decidedBy: string
}

/** Parts `filing` past their claim (the job died, or its person left). Platform scope. */
export async function findLapsedClaims(now: Date, limit: number): Promise<LapsedClaim[]> {
  return select<LapsedClaim>(sql`
    SELECT p.id AS "partId", p.decision_id AS "decisionId", p.mail_id AS "mailId",
           p.organization_id AS "organizationId", p.project_id AS "projectId", d.decided_by AS "decidedBy"
      FROM inbound_mail_parts p
      JOIN inbound_mail_decisions d ON d.id = p.decision_id
     WHERE p.state = 'filing' AND p.claim_expires_at < ${now.toISOString()}::timestamptz
     ORDER BY p.claim_expires_at
     LIMIT ${limit}`)
}

/** The part waits again, `unavailable`: only while it is still filing on the same, lapsed claim. */
export async function returnLapsedClaim(claim: LapsedClaim, now: Date): Promise<boolean> {
  const rows = await getDb()
    .update(inboundMailParts)
    .set({ state: 'waiting', decisionId: null, claimExpiresAt: null, lastFailure: 'unavailable', updatedAt: now })
    .where(
      and(
        eq(inboundMailParts.id, claim.partId),
        eq(inboundMailParts.state, 'filing'),
        eq(inboundMailParts.decisionId, claim.decisionId),
        lt(inboundMailParts.claimExpiresAt, now),
      ),
    )
    .returning({ id: inboundMailParts.id })
  return rows.length === 1
}

// ---------------------------------------------------------------------------
// Sweep 7: scans that failed
// ---------------------------------------------------------------------------

/** How many times a failed scan is tried again, an hour apart (D16). */
export const RESCAN_ATTEMPTS = 24
export const RESCAN_AFTER_MS = 60 * 60 * 1000

/** A staged object whose scan failed and is due again. */
export interface FailedScan {
  /** The part's id, or the mail's for its raw message. */
  id: string
  kind: 'part' | 'raw'
  mailId: string
  organizationId: string
  projectId: string
  /** The mail's class: a verified writer's mail gets its sender's filing again once a scan is clean. */
  senderClass: InboundMailSenderClass | null
  stagingBucket: string
  storageKey: string
}

/** Waiting parts and held raw messages whose scan failed an hour ago or more, under the attempt cap. Platform scope. */
export async function findFailedScans(now: Date, limit: number): Promise<FailedScan[]> {
  const due = new Date(now.getTime() - RESCAN_AFTER_MS).toISOString()
  return select<FailedScan>(sql`
    (SELECT p.id, 'part' AS kind, p.mail_id AS "mailId", p.organization_id AS "organizationId",
            m.project_id AS "projectId", m.sender_class AS "senderClass",
            m.staging_bucket AS "stagingBucket", p.storage_key AS "storageKey"
       FROM inbound_mail_parts p
       JOIN inbound_mails m ON m.id = p.mail_id
      WHERE p.scan_status = 'failed' AND p.state = 'waiting' AND p.storage_key IS NOT NULL
        AND p.scan_attempts < ${RESCAN_ATTEMPTS} AND p.scanned_at < ${due}::timestamptz
      ORDER BY p.scanned_at
      LIMIT ${limit})
    UNION ALL
    (SELECT m.id, 'raw' AS kind, m.id AS "mailId", m.organization_id AS "organizationId",
            m.project_id AS "projectId", m.sender_class AS "senderClass",
            m.staging_bucket AS "stagingBucket", m.raw_storage_key AS "storageKey"
       FROM inbound_mails m
      WHERE m.raw_scan_status = 'failed' AND m.status = 'waiting' AND m.raw_storage_key IS NOT NULL
        AND m.raw_scan_attempts < ${RESCAN_ATTEMPTS} AND m.raw_scanned_at < ${due}::timestamptz
      ORDER BY m.raw_scanned_at
      LIMIT ${limit})`)
}

/** Store a repeated scan of a part, counted; only while its scan is still the failed one. */
export async function recordPartRescan(partId: string, scan: StoredScan): Promise<boolean> {
  const rows = await getDb()
    .update(inboundMailParts)
    .set({
      scanStatus: scan.status,
      scanEngine: scan.engine,
      scanSignature: scan.status === 'infected' ? scan.signature : null,
      scannedAt: scan.scannedAt,
      scanAttempts: sql`least(${inboundMailParts.scanAttempts} + 1, 100)`,
      updatedAt: new Date(),
    })
    .where(and(eq(inboundMailParts.id, partId), eq(inboundMailParts.scanStatus, 'failed'), eq(inboundMailParts.state, 'waiting')))
    .returning({ id: inboundMailParts.id })
  return rows.length === 1
}

/** Store a repeated scan of a held mail's raw message, counted; only while it is still the failed one. */
export async function recordRawRescan(mailId: string, scan: StoredScan): Promise<boolean> {
  const rows = await getDb()
    .update(inboundMails)
    .set({
      rawScanStatus: scan.status,
      rawScanEngine: scan.engine,
      rawScanSignature: scan.status === 'infected' ? scan.signature : null,
      rawScannedAt: scan.scannedAt,
      rawScanAttempts: sql`least(${inboundMails.rawScanAttempts} + 1, 100)`,
      updatedAt: new Date(),
    })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.rawScanStatus, 'failed'), eq(inboundMails.status, 'waiting')))
    .returning({ id: inboundMails.id })
  return rows.length === 1
}

// ---------------------------------------------------------------------------
// Sweep 15: texts the reader did not answer for
// ---------------------------------------------------------------------------

/** How long after the reader last failed a text is read again. */
export const REREAD_AFTER_MS = 15 * 60 * 1000

/** A waiting mail whose text the Python reader did not answer for (`reader_fault_at`, migration 0196). */
export interface UnreadText {
  id: string
  organizationId: string
  projectId: string
  addressId: string
  stagingBucket: string
  rawStorageKey: string
  readerFaultAt: Date
  senderClass: InboundMailSenderClass | null
}

/**
 * Waiting mails, within their window, whose text waits unread because the
 * reader did not answer, last tried before `REREAD_AFTER_MS` ago, with the raw
 * message still staged and the text still waiting. Platform scope.
 */
export async function findUnreadTexts(now: Date, limit: number): Promise<UnreadText[]> {
  const due = new Date(now.getTime() - REREAD_AFTER_MS).toISOString()
  const rows = await select<UnreadText>(sql`
    SELECT m.id, m.organization_id AS "organizationId", m.project_id AS "projectId", m.address_id AS "addressId",
           m.staging_bucket AS "stagingBucket", m.raw_storage_key AS "rawStorageKey",
           m.reader_fault_at AS "readerFaultAt", m.sender_class AS "senderClass"
      FROM inbound_mails m
     WHERE m.status = 'waiting' AND m.reader_fault_at IS NOT NULL AND m.reader_fault_at < ${due}::timestamptz
       AND m.expires_at > ${now.toISOString()}::timestamptz AND m.raw_storage_key IS NOT NULL
       AND EXISTS (SELECT 1 FROM inbound_mail_parts p WHERE p.mail_id = m.id AND p.kind = 'message' AND p.state = 'waiting')
     ORDER BY m.reader_fault_at
     LIMIT ${limit}`)
  return rows.map((row) => ({ ...row, readerFaultAt: new Date(row.readerFaultAt) }))
}

/** What a re-read gives the text part and the mail. */
export interface RereadText {
  readStorageKey: string
  sha256: string
  sizeBytes: number
  riskFlags: PartRiskFlag[]
  contentFindings: InboundMailContentFinding[]
}

/**
 * The text read at last: the mail's `read.json` and its text part, in one
 * transaction, compare-and-set on the fault the find saw and on the part
 * still waiting. False when a person decided first or another run read it.
 */
export async function recordReread(mail: UnreadText, text: RereadText): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const read = await tx
      .update(inboundMails)
      .set({ readStorageKey: text.readStorageKey, readerFaultAt: null, updatedAt: now })
      .where(and(eq(inboundMails.id, mail.id), eq(inboundMails.status, 'waiting'), faultSeen(mail)))
      .returning({ id: inboundMails.id })
    if (read.length === 0) return false
    const part = await tx
      .update(inboundMailParts)
      .set({ sha256: text.sha256, sizeBytes: text.sizeBytes, riskFlags: text.riskFlags, contentFindings: text.contentFindings, updatedAt: now })
      .where(and(eq(inboundMailParts.mailId, mail.id), eq(inboundMailParts.kind, 'message'), eq(inboundMailParts.state, 'waiting')))
      .returning({ id: inboundMailParts.id })
    // Thrown, not `tx.rollback()`, which throws the driver's own error (`LostCompareAndSwap` in documents/version-repository).
    if (part.length === 0) throw new TextNoLongerWaiting()
    return true
  }).catch((error: unknown) => {
    if (error instanceof TextNoLongerWaiting) return false
    throw error
  })
}

/** The text part was decided between the find and the write: the mail's half rolls back with it. */
class TextNoLongerWaiting extends Error {}

/**
 * The fault the find saw, to the millisecond: Postgres keeps microseconds and a
 * `Date` milliseconds, so a plain equality never matches what was read back.
 */
const faultSeen = (mail: UnreadText) =>
  sql`date_trunc('milliseconds', ${inboundMails.readerFaultAt}) = ${mail.readerFaultAt.toISOString()}::timestamptz`

/** The reader did not answer again: tried again after `REREAD_AFTER_MS`. */
export async function postponeReread(mail: UnreadText, now: Date): Promise<boolean> {
  const rows = await getDb()
    .update(inboundMails)
    .set({ readerFaultAt: now, updatedAt: now })
    .where(and(eq(inboundMails.id, mail.id), eq(inboundMails.status, 'waiting'), faultSeen(mail)))
    .returning({ id: inboundMails.id })
  return rows.length === 1
}

// ---------------------------------------------------------------------------
// Sweep 11: decisions still owed to the audit trail
// ---------------------------------------------------------------------------

/** Decisions not audited since `before` (the request that made them sends them first). Platform scope. */
export async function findUnauditedDecisions(before: Date, limit: number): Promise<InboundMailDecisionRow[]> {
  return getDb()
    .select()
    .from(inboundMailDecisions)
    .where(and(isNull(inboundMailDecisions.auditedAt), lt(inboundMailDecisions.decidedAt, before)))
    .orderBy(inboundMailDecisions.decidedAt)
    .limit(limit)
}

// ---------------------------------------------------------------------------
// Sweep 13: originals whose move stopped half-way
// ---------------------------------------------------------------------------

/** A mail whose raw message was being moved to its entry's original when the run stopped. */
export interface StalledMove {
  id: string
  organizationId: string
  projectId: string
}

/** Moves pending since `before`. Platform scope. */
export async function findStalledMoves(before: Date, limit: number): Promise<StalledMove[]> {
  return select<StalledMove>(sql`
    SELECT m.id, m.organization_id AS "organizationId", m.project_id AS "projectId"
      FROM inbound_mails m
     WHERE m.original_move_pending_at < ${before.toISOString()}::timestamptz
     ORDER BY m.original_move_pending_at
     LIMIT ${limit}`)
}

// ---------------------------------------------------------------------------
// The caps (D18): what each address's managers were told
// ---------------------------------------------------------------------------

/** An address whose staged bytes call for a notice, or whose notice is out of date. */
export interface AddressCapState {
  id: string
  organizationId: string
  projectId: string
  revoked: boolean
  capNotice: InboundMailCapNotice | null
  addressBytes: number
  organizationBytes: number
}

/**
 * Every address at 80% of its cap or whose organization is at 80% of its own,
 * and every address that was told and may need settling. The bytes are
 * counted as the webhook counts them (`stagedBytes`): raw messages of mail
 * arriving, received or waiting. Platform scope.
 */
export async function findAddressCapStates(
  caps: { address: number; organization: number },
  limit: number,
): Promise<AddressCapState[]> {
  const rows = await select<Omit<AddressCapState, 'addressBytes' | 'organizationBytes'> & { addressBytes: string; organizationBytes: string }>(sql`
    WITH staged AS (
      SELECT organization_id, address_id, sum(raw_size_bytes) AS bytes
        FROM inbound_mails
       WHERE status IN ('receiving', 'received', 'waiting') AND raw_storage_key IS NOT NULL
       GROUP BY organization_id, address_id),
    per_org AS (SELECT organization_id, sum(bytes) AS bytes FROM staged GROUP BY organization_id)
    SELECT a.id, a.organization_id AS "organizationId", a.project_id AS "projectId",
           (a.revoked_at IS NOT NULL) AS revoked, a.cap_notice AS "capNotice",
           coalesce(s.bytes, 0) AS "addressBytes", coalesce(o.bytes, 0) AS "organizationBytes"
      FROM inbound_mail_addresses a
      LEFT JOIN staged s ON s.address_id = a.id
      LEFT JOIN per_org o ON o.organization_id = a.organization_id
     WHERE a.cap_notice IS NOT NULL
        OR (a.revoked_at IS NULL
            AND (coalesce(s.bytes, 0) >= ${Math.floor(caps.address * 0.8)}
                 OR coalesce(o.bytes, 0) >= ${Math.floor(caps.organization * 0.8)}))
     ORDER BY a.id
     LIMIT ${limit}`)
  return rows.map((row) => ({ ...row, addressBytes: Number(row.addressBytes), organizationBytes: Number(row.organizationBytes) }))
}

/**
 * Record what the address's managers are told now, from what they were told
 * (compare-and-set): whether this call changed it.
 */
export async function setCapNotice(
  addressId: string,
  from: InboundMailCapNotice | null,
  to: InboundMailCapNotice | null,
  now: Date,
): Promise<boolean> {
  const rows = await getDb()
    .update(inboundMailAddresses)
    .set({ capNotice: to, capNoticedAt: to ? now : null })
    .where(
      and(
        eq(inboundMailAddresses.id, addressId),
        from === null ? isNull(inboundMailAddresses.capNotice) : eq(inboundMailAddresses.capNotice, from),
      ),
    )
    .returning({ id: inboundMailAddresses.id })
  return rows.length === 1
}
