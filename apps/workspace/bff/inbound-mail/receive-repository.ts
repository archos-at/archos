/**
 * SQL for the receive job (ADR-0137): the mail it reads, its scan, the thread
 * it may belong to, what the project already holds of it, and the held mail it
 * leaves for a person.
 *
 * No authorization here: the service decides who may ask, and row-level
 * security is the backstop. Every list is bounded. The rules a row must keep
 * are CHECKs in the migration (`./repository.ts`).
 */

import 'server-only'
import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { inboundMailAddresses, inboundMailParts, inboundMails, type InboundMailRow, type NewInboundMailPartRow, type NewInboundMailRow } from '@/lib/db/schema/inbound-mail'
import { mailThreadEntries, mailThreadFollows, mailThreadMessageIds, mailThreads } from '@/lib/db/schema/mail-thread'
import { documentVisibleTo, SCREENED_ONLY } from '@/lib/documents/visibility'
import type { FollowRow } from '@/lib/mail-thread/follow-eligibility'
import type { ThreadCandidate } from '@/lib/mail-thread/mail-threading'
import type { InboundMailSenderClass, MalwareScanStatus } from './inbound-mail-vocabulary'

/** The mail the receive job reads, in any status: a job that finds it past `received` has nothing to do. */
export async function findMailForReceive(mailId: string): Promise<InboundMailRow | null> {
  const [row] = await getDb().select().from(inboundMails).where(eq(inboundMails.id, mailId)).limit(1)
  return row ?? null
}

/** A scan's outcome as the columns store it. */
export interface StoredScan {
  status: Exclude<MalwareScanStatus, 'pending'>
  /** Engine and signature-database version (`ClamAV 1.5.4/28157`); null when no engine answered. */
  engine: string | null
  /** The malware's name, for `infected` only. */
  signature: string | null
  scannedAt: Date
}

/**
 * The whole raw message's scan (D16). Recorded while the mail is still
 * `received`, so a job that dies after it does not scan again, and a mail is
 * never `waiting` without one (`inbound_mails_waiting_is_scanned`).
 */
export async function recordRawScan(mailId: string, scan: StoredScan): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({
      rawScanStatus: scan.status,
      rawScanEngine: scan.engine,
      rawScanSignature: scan.status === 'infected' ? scan.signature : null,
      rawScannedAt: scan.scannedAt,
      rawScanAttempts: sql`least(${inboundMails.rawScanAttempts} + 1, 100)`,
      updatedAt: new Date(),
    })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'received')))
}

/**
 * Keep what a run learned for the next run of the same mail
 * (`./receive-progress.ts`), while it is still `received`.
 */
export async function keepReceiveProgress(mailId: string, progress: Record<string, unknown>): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ receiveProgress: progress, updatedAt: new Date() })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'received')))
}

/**
 * Drop an automatic mail nobody needs to see: an auto-reply, a delivery
 * report, a loop (`dropped_reason`). Scrubbed in the same statement
 * (`inbound_mails_ended_is_scrubbed`): the envelope sender goes, and the raw
 * message's key goes once its object is erased, unless a legal hold deferred
 * that (`erasureDeferred`). Whether this call dropped it.
 */
export async function dropMail(
  mailId: string,
  input: { reason: NonNullable<InboundMailRow['droppedReason']>; erasureDeferred: boolean },
): Promise<boolean> {
  const now = new Date()
  const rows = await getDb()
    .update(inboundMails)
    .set({
      status: 'dropped',
      droppedReason: input.reason,
      envelopeFrom: null,
      receiveProgress: null,
      rawStorageKey: input.erasureDeferred ? inboundMails.rawStorageKey : null,
      erasureDeferredAt: input.erasureDeferred ? now : null,
      updatedAt: now,
    })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'received')))
    .returning({ id: inboundMails.id })
  return rows.length > 0
}

/** The mail's identifiers a thread can be found by. */
export interface ThreadKeys {
  /** The mail's own Message-ID, In-Reply-To and References, normalized. */
  messageIds: readonly string[]
  threadIndexGuid: string | null
  baseSubject: string
  /** The mail's participant addresses, lower-cased, the project's own taken out. */
  participants: readonly string[]
}

/** Threads looked at per mail; a project with more matching threads than this is past what a person picks from. */
const MAX_THREAD_CANDIDATES = 50

/**
 * The project's threads this mail could belong to, in the shape the matching
 * ladder reads (`matchThread`): any thread that received or was referred to by
 * one of the mail's ids, shares its Outlook conversation GUID, or has its base
 * subject. Only threads with a live document: a thread being written for the
 * first time, or whose document is gone, is nothing to file into. The one
 * exception is the archive import's own (`pendingOfImport`): a Verlauf a slice
 * opened has its first Fassung only at the slice's end, and the slice's later
 * mails of the same conversation belong in it (`lib/mail-thread/archive.ts`).
 *
 * The id and participant lists hold only what the mail shares with each
 * thread, which is all the ladder asks of them; a 200-entry thread's whole
 * history is never loaded for one mail.
 */
export async function findThreadCandidates(
  projectId: string,
  keys: ThreadKeys,
  options: { pendingOfImport?: string } = {},
): Promise<ThreadCandidate[]> {
  const db = getDb()
  const ids = [...new Set(keys.messageIds)].slice(0, 64)
  const byIds =
    ids.length > 0
      ? db
          .selectDistinct({ threadId: mailThreadMessageIds.threadId })
          .from(mailThreadMessageIds)
          .where(and(eq(mailThreadMessageIds.projectId, projectId), inArray(mailThreadMessageIds.messageId, ids)))
      : null
  const threads = await db
    .select({
      threadId: mailThreads.id,
      baseSubject: mailThreads.baseSubject,
      threadIndexGuid: mailThreads.threadIndexGuid,
      lastEntryAt: mailThreads.lastEntryAt,
    })
    .from(mailThreads)
    .where(
      and(
        eq(mailThreads.projectId, projectId),
        or(isNotNull(mailThreads.documentId), pendingOfImport(options.pendingOfImport)),
        or(
          byIds ? inArray(mailThreads.id, byIds) : undefined,
          keys.threadIndexGuid ? eq(mailThreads.threadIndexGuid, keys.threadIndexGuid) : undefined,
          keys.baseSubject ? eq(mailThreads.baseSubject, keys.baseSubject) : undefined,
          sql`false`,
        ),
      ),
    )
    .orderBy(desc(mailThreads.lastEntryAt))
    .limit(MAX_THREAD_CANDIDATES)
  if (threads.length === 0) return []
  const threadIds = threads.map((thread) => thread.threadId)
  const [knownIds, shared] = await Promise.all([
    ids.length > 0
      ? db
          .select({ threadId: mailThreadMessageIds.threadId, messageId: mailThreadMessageIds.messageId, state: mailThreadMessageIds.state })
          .from(mailThreadMessageIds)
          .where(and(inArray(mailThreadMessageIds.threadId, threadIds), inArray(mailThreadMessageIds.messageId, ids)))
          .limit(MAX_THREAD_CANDIDATES * 64)
      : Promise.resolve([]),
    sharedParticipants(threadIds, keys.participants),
  ])
  return threads.map((thread) => ({
    threadId: thread.threadId,
    baseSubject: thread.baseSubject,
    threadIndexGuid: thread.threadIndexGuid,
    receivedIds: knownIds.filter((row) => row.threadId === thread.threadId && row.state === 'received').map((row) => row.messageId),
    referencedIds: knownIds
      .filter((row) => row.threadId === thread.threadId && row.state === 'referenced')
      .map((row) => row.messageId),
    participants: shared.get(thread.threadId) ?? [],
    lastEntryAt: thread.lastEntryAt ? new Date(thread.lastEntryAt) : null,
  }))
}

/** A thread with no document yet that this archive import opened and has not rendered (`render_pending_at`). */
function pendingOfImport(importId: string | undefined): SQL | undefined {
  if (!importId) return undefined
  return and(
    isNull(mailThreads.documentId),
    isNotNull(mailThreads.renderPendingAt),
    sql`EXISTS (SELECT 1 FROM ${mailThreadEntries} e WHERE e.thread_id = ${mailThreads.id} AND e.mail_import_id = ${importId}::uuid)`,
  )
}

/** Which of `addresses` took part in each thread, as a sender or a recipient of a filed entry. */
async function sharedParticipants(threadIds: readonly string[], addresses: readonly string[]): Promise<Map<string, string[]>> {
  const wanted = [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 200)
  if (threadIds.length === 0 || wanted.length === 0) return new Map()
  const rows = await getDb().execute<{ thread_id: string; address: string }>(sql`
    SELECT DISTINCT e.thread_id, lower(p.address) AS address
    FROM ${mailThreadEntries} e
    CROSS JOIN LATERAL (
      SELECT e.sender_address AS address
      UNION ALL
      SELECT value ->> 'address' FROM jsonb_array_elements(e.participants)
    ) p
    WHERE e.thread_id IN (${sql.join(threadIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND lower(p.address) IN (${sql.join(wanted.map((address) => sql`${address}`), sql`, `)})
    LIMIT 2000
  `)
  const shared = new Map<string, string[]>()
  for (const row of Array.from(rows)) {
    const threadId = String(row.thread_id)
    shared.set(threadId, [...(shared.get(threadId) ?? []), String(row.address)])
  }
  return shared
}

/** A filed message of the project with a given Message-ID (D11, D33). */
export interface FiledMessage {
  entryId: string
  threadId: string
  source: 'inbound' | 'archive'
  /** SHA-256 hex of the entry's own text, compared with the held mail's. */
  ownTextSha256: string
}

/**
 * The project's filed messages that received this Message-ID: what decides
 * `message_id_reused` (an id the project already has, perhaps a forger's) and
 * `already_filed` (the same message is in a Verlauf already). Received ids are
 * keyed per entry, so a forger who took a genuine id first is one row of
 * several and never blocks the genuine message (RT-S1).
 */
export async function findFiledMessages(projectId: string, messageId: string): Promise<FiledMessage[]> {
  const rows = await getDb()
    .select({
      entryId: mailThreadEntries.id,
      threadId: mailThreadEntries.threadId,
      source: mailThreadEntries.source,
      ownTextSha256: sql<string>`encode(sha256(convert_to(${mailThreadEntries.ownText}, 'UTF8')), 'hex')`,
    })
    .from(mailThreadMessageIds)
    .innerJoin(mailThreadEntries, eq(mailThreadEntries.id, mailThreadMessageIds.entryId))
    .where(
      and(
        eq(mailThreadMessageIds.projectId, projectId),
        eq(mailThreadMessageIds.messageId, messageId),
        eq(mailThreadMessageIds.state, 'received'),
      ),
    )
    .limit(20)
  return rows.map((row) => ({ ...row, ownTextSha256: String(row.ownTextSha256) }))
}

/**
 * Screened documents of the project that hold exactly these bytes, by content
 * hash: the `duplicate_of` candidate of an attachment. Ids only, stored on the
 * part; whether the viewer may see the document is decided when the mail is
 * read (RT-S13). A held document is never a candidate (`SCREENED_ONLY`): its
 * existence is not the project's yet.
 */
export async function findScreenedDuplicates(projectId: string, sha256s: readonly string[]): Promise<Map<string, string>> {
  const hashes = [...new Set(sha256s)].slice(0, 100)
  if (hashes.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: documents.id, contentHash: documents.contentHash })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), inArray(documents.contentHash, hashes), documentVisibleTo(SCREENED_ONLY)))
    .orderBy(desc(documents.createdAt))
    .limit(500)
  return firstByKey(rows.map((row) => [row.contentHash ?? '', row.id]))
}

/**
 * Screened documents of the project under exactly these names (their stored,
 * composed form): the attachment that would become their next Fassung
 * (`revision_candidate_document_id`). Ids only, judged for the viewer at read
 * time, like {@link findScreenedDuplicates}.
 */
export async function findScreenedNamesakes(projectId: string, filenames: readonly string[]): Promise<Map<string, string>> {
  const names = [...new Set(filenames)].slice(0, 100)
  if (names.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: documents.id, filename: documents.filename })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), inArray(documents.filename, names), documentVisibleTo(SCREENED_ONLY)))
    .orderBy(desc(documents.createdAt))
    .limit(500)
  return firstByKey(rows.map((row) => [row.filename, row.id]))
}

/** The first value per key, in row order (newest first). */
function firstByKey(entries: ReadonlyArray<readonly [string, string]>): Map<string, string> {
  const found = new Map<string, string>()
  for (const [key, value] of entries) if (key && !found.has(key)) found.set(key, value)
  return found
}

/** What following needs of one thread (D31): its participant domains and its follows that have not ended. */
export interface ThreadFollowContext {
  threadId: string
  participantDomains: string[]
  follows: FollowRow[]
}

/** {@link ThreadFollowContext} of one thread of the project, or null when it has no live document. */
export async function findThreadFollowContext(projectId: string, threadId: string): Promise<ThreadFollowContext | null> {
  const db = getDb()
  const [thread] = await db
    .select({ id: mailThreads.id, participantDomains: mailThreads.participantDomains })
    .from(mailThreads)
    .where(and(eq(mailThreads.id, threadId), eq(mailThreads.projectId, projectId), isNotNull(mailThreads.documentId)))
    .limit(1)
  if (!thread) return null
  const follows = await db
    .select({
      id: mailThreadFollows.id,
      userId: mailThreadFollows.userId,
      createdAt: mailThreadFollows.createdAt,
      expiresAt: mailThreadFollows.expiresAt,
      endedAt: mailThreadFollows.endedAt,
    })
    .from(mailThreadFollows)
    .where(and(eq(mailThreadFollows.threadId, threadId), isNull(mailThreadFollows.endedAt)))
    .orderBy(mailThreadFollows.createdAt)
    .limit(50)
  return {
    threadId: thread.id,
    participantDomains: thread.participantDomains,
    follows: follows.map((follow) => ({
      ...follow,
      createdAt: new Date(follow.createdAt),
      expiresAt: new Date(follow.expiresAt),
      endedAt: follow.endedAt ? new Date(follow.endedAt) : null,
    })),
  }
}

/**
 * What the receive job writes onto the mail when it is held: what it read, the
 * verdict on the sender and, with it, the sender's class and the window that
 * class gives (migration 0197 freezes all three after this write).
 */
export type HeldMailFields = HeldMailColumns & { senderClass: InboundMailSenderClass; expiresAt: Date }

type HeldMailColumns = Pick<
  NewInboundMailRow,
  | 'readStorageKey'
  | 'messageId'
  | 'inReplyTo'
  | 'referenceIds'
  | 'threadIndexGuid'
  | 'baseSubject'
  | 'threadMatch'
  | 'senderAddress'
  | 'senderName'
  | 'subject'
  | 'participants'
  | 'participantDomains'
  | 'recipientCount'
  | 'senderTrust'
  | 'senderUserId'
  | 'senderReason'
  | 'signerDomain'
  | 'signedHeaders'
  | 'senderFlags'
  | 'authenticationResults'
  | 'automatic'
  | 'sentAt'
  | 'sentAtHeader'
  | 'notStaged'
  | 'ignored'
  | 'readerFaultAt'
>

/**
 * Hold the mail for a person: insert its parts and move it to `waiting`, in one
 * transaction, so a person never sees a mail without its parts. Only from
 * `received`: whether this call held it (a second run of the job finds it held
 * and does nothing). The database refuses a `waiting` mail whose raw message
 * was not scanned, and a part that breaks any of its rules.
 */
export async function holdMail(
  mailId: string,
  fields: HeldMailFields,
  parts: readonly NewInboundMailPartRow[],
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const held = await tx
      .update(inboundMails)
      .set({ ...fields, status: 'waiting', receiveProgress: null, updatedAt: now })
      .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'received')))
      .returning({ id: inboundMails.id })
    if (held.length === 0) return false
    if (parts.length > 0) await tx.insert(inboundMailParts).values([...parts])
    return true
  })
}

/** The token of the address a mail arrived at: what its signed recipients must name (D4), and the one B8 keeps. */
export async function findAddressToken(addressId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ token: inboundMailAddresses.token })
    .from(inboundMailAddresses)
    .where(eq(inboundMailAddresses.id, addressId))
    .limit(1)
  return row?.token ?? null
}

/** One part of a held mail, as its announcement and audit read it: kind and flags, no name. */
export interface PartSummary {
  kind: 'message' | 'attachment'
  riskFlags: string[]
  contentFindings: string[]
}

/** The parts of a held mail, in position order (at most 101: the text and 100 attachments). */
export async function findPartSummaries(mailId: string): Promise<PartSummary[]> {
  return getDb()
    .select({ kind: inboundMailParts.kind, riskFlags: inboundMailParts.riskFlags, contentFindings: inboundMailParts.contentFindings })
    .from(inboundMailParts)
    .where(eq(inboundMailParts.mailId, mailId))
    .orderBy(inboundMailParts.position)
    .limit(200)
}

/**
 * The held mail was announced (`notified_at`): its job's last step, so a job
 * that died between holding the mail and telling anyone finishes the telling
 * when it runs again, and a job that finished never tells twice.
 */
export async function markNotified(mailId: string, at: Date = new Date()): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ notifiedAt: at, updatedAt: at })
    .where(and(eq(inboundMails.id, mailId), isNull(inboundMails.notifiedAt)))
}
