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
import { planName, planNamePattern, revisionCandidateOf } from './plan-index'

export async function findMailForReceive(mailId: string): Promise<InboundMailRow | null> {
  const [row] = await getDb().select().from(inboundMails).where(eq(inboundMails.id, mailId)).limit(1)
  return row ?? null
}

export interface StoredScan {
  status: Exclude<MalwareScanStatus, 'pending'>
  engine: string | null
  signature: string | null
  scannedAt: Date
}

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

export async function keepReceiveProgress(mailId: string, progress: Record<string, unknown>): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ receiveProgress: progress, updatedAt: new Date() })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'received')))
}

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

export interface ThreadKeys {
  messageIds: readonly string[]
  threadIndexGuid: string | null
  baseSubject: string
  participants: readonly string[]
}

const MAX_THREAD_CANDIDATES = 50

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
  const cited = or(
    byIds ? inArray(mailThreads.id, byIds) : undefined,
    keys.threadIndexGuid ? eq(mailThreads.threadIndexGuid, keys.threadIndexGuid) : undefined,
  )
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
        or(cited, keys.baseSubject ? eq(mailThreads.baseSubject, keys.baseSubject) : undefined, sql`false`),
      ),
    )
    .orderBy(...(cited ? [sql`CASE WHEN ${cited} THEN 0 ELSE 1 END`] : []), desc(mailThreads.lastEntryAt))
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

function pendingOfImport(importId: string | undefined): SQL | undefined {
  if (!importId) return undefined
  return and(
    isNull(mailThreads.documentId),
    isNotNull(mailThreads.renderPendingAt),
    sql`EXISTS (SELECT 1 FROM ${mailThreadEntries} e WHERE e.thread_id = ${mailThreads.id} AND e.mail_import_id = ${importId}::uuid)`,
  )
}

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

export interface FiledMessage {
  entryId: string
  threadId: string
  source: 'inbound' | 'archive'
  ownTextSha256: string
}

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

export async function findScreenedRevisionCandidates(projectId: string, filenames: readonly string[]): Promise<Map<string, string>> {
  const names = [...new Set(filenames)].slice(0, 100)
  if (names.length === 0) return new Map()
  const patterns = [...new Set(names.flatMap((name) => {
    const plan = planName(name)
    return plan ? [planNamePattern(plan)] : []
  }))]
  const samePlanNumber = patterns.length === 0
    ? undefined
    : sql`lower(${documents.filename}) LIKE ANY(ARRAY[${sql.join(patterns.map((pattern) => sql`${pattern}`), sql`, `)}]::text[])`
  const rows = await getDb()
    .select({ id: documents.id, filename: documents.filename })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), or(inArray(documents.filename, names), samePlanNumber), documentVisibleTo(SCREENED_ONLY)))
    .orderBy(
      sql`(SELECT max(v.created_at) FROM document_versions v WHERE v.document_id = ${documents.id}) DESC NULLS LAST`,
      desc(documents.createdAt),
    )
    .limit(500)
  const found = new Map<string, string>()
  for (const name of names) {
    const candidate = revisionCandidateOf(name, rows)
    if (candidate) found.set(name, candidate.id)
  }
  return found
}

function firstByKey(entries: ReadonlyArray<readonly [string, string]>): Map<string, string> {
  const found = new Map<string, string>()
  for (const [key, value] of entries) if (key && !found.has(key)) found.set(key, value)
  return found
}

export interface ThreadFollowContext {
  threadId: string
  participantDomains: string[]
  participantAddresses: string[]
  follows: FollowRow[]
}

export async function findThreadFollowContext(
  projectId: string,
  threadId: string,
  addresses: readonly string[],
): Promise<ThreadFollowContext | null> {
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
  const known = await sharedParticipants([thread.id], addresses)
  return {
    threadId: thread.id,
    participantDomains: thread.participantDomains,
    participantAddresses: known.get(thread.id) ?? [],
    follows: follows.map((follow) => ({
      ...follow,
      createdAt: new Date(follow.createdAt),
      expiresAt: new Date(follow.expiresAt),
      endedAt: follow.endedAt ? new Date(follow.endedAt) : null,
    })),
  }
}

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

export async function findAddressToken(addressId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ token: inboundMailAddresses.token })
    .from(inboundMailAddresses)
    .where(eq(inboundMailAddresses.id, addressId))
    .limit(1)
  return row?.token ?? null
}

export interface PartSummary {
  kind: 'message' | 'attachment'
  riskFlags: string[]
  contentFindings: string[]
}

export async function findPartSummaries(mailId: string): Promise<PartSummary[]> {
  return getDb()
    .select({ kind: inboundMailParts.kind, riskFlags: inboundMailParts.riskFlags, contentFindings: inboundMailParts.contentFindings })
    .from(inboundMailParts)
    .where(eq(inboundMailParts.mailId, mailId))
    .orderBy(inboundMailParts.position)
    .limit(200)
}

export async function markNotified(mailId: string, at: Date = new Date()): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ notifiedAt: at, updatedAt: at })
    .where(and(eq(inboundMails.id, mailId), isNull(inboundMails.notifiedAt)))
}
