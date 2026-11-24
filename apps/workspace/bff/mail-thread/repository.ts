import 'server-only'

import { and, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { inboundMailParts, inboundMails, type InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { mailThreadEntries, mailThreadEntryAttachments, mailThreadFollows, mailThreadMessageIds, mailThreads, type MailThreadEntryRow, type MailThreadFollowRow } from '@/lib/db/schema/mail-thread'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { documentDisplayName } from '@/lib/documents/display-name'
import { CURSOR_TIMESTAMP_FORMAT } from '@/lib/documents/list-cursor'
import { documentVisibleTo, SCREENED_ONLY } from '@/lib/documents/visibility'
import type { ThreadMatch } from './mail-threading'
import { VERIFIED_SENDER_TRUSTS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { MailThreadAttachmentDisposition, MailThreadAttachmentNotFiledReason } from './mail-thread-wire'
import { MAIL_THREAD_MAX_ENTRIES, MAIL_THREAD_WAITING_REASONS, type MailThreadWaitingReason } from './mail-thread-vocabulary'

export interface ThreadRow {
  id: string
  documentId: string
  name: string
  folderId: string | null
  entryCount: number
  lastEntryAt: Date | null
  participantDomains: string[]
  continuesThreadId: string | null
  createdAtText: string
}

export interface ThreadListPosition {
  createdAt: string
  id: string
}

function visibleThreads(projectId: string, hiddenFolders: readonly string[]) {
  return and(
    eq(mailThreads.projectId, projectId),
    documentVisibleTo(SCREENED_ONLY),
    or(isNull(documents.folderId), isNull(projectFolders.deletedAt)),
    hiddenFolders.length > 0 ? or(isNull(documents.folderId), notInArray(documents.folderId, [...hiddenFolders])) : undefined,
  )
}

const threadColumns = {
  id: mailThreads.id,
  documentId: documents.id,
  filename: documents.filename,
  displayName: documents.displayName,
  folderId: documents.folderId,
  entryCount: mailThreads.entryCount,
  lastEntryAt: mailThreads.lastEntryAt,
  participantDomains: mailThreads.participantDomains,
  continuesThreadId: mailThreads.continuesThreadId,
  createdAtText: sql<string>`to_char(${mailThreads.createdAt} AT TIME ZONE 'UTC', ${CURSOR_TIMESTAMP_FORMAT})`,
}

type ThreadColumns = {
  id: string
  documentId: string
  filename: string
  displayName: string | null
  folderId: string | null
  entryCount: number
  lastEntryAt: Date | string | null
  participantDomains: string[]
  continuesThreadId: string | null
  createdAtText: string
}

const toThreadRow = (row: ThreadColumns): ThreadRow => ({
  id: row.id,
  documentId: row.documentId,
  name: documentDisplayName({ filename: row.filename, displayName: row.displayName }),
  folderId: row.folderId,
  entryCount: row.entryCount,
  lastEntryAt: row.lastEntryAt ? new Date(row.lastEntryAt) : null,
  participantDomains: row.participantDomains,
  continuesThreadId: row.continuesThreadId,
  createdAtText: String(row.createdAtText),
})

export async function listVisibleThreads(
  projectId: string,
  hiddenFolders: readonly string[],
  query: { documentId?: string; limit: number },
  after: ThreadListPosition | null,
): Promise<ThreadRow[]> {
  const position = after
    ? sql`(${mailThreads.createdAt} < (${after.createdAt})::timestamp AT TIME ZONE 'UTC'
         OR (${mailThreads.createdAt} = (${after.createdAt})::timestamp AT TIME ZONE 'UTC' AND ${mailThreads.id} > ${after.id}))`
    : undefined
  const rows = await getDb()
    .select(threadColumns)
    .from(mailThreads)
    .innerJoin(documents, and(eq(documents.id, mailThreads.documentId), eq(documents.projectId, mailThreads.projectId)))
    .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(
      and(
        visibleThreads(projectId, hiddenFolders),
        query.documentId ? eq(mailThreads.documentId, query.documentId) : undefined,
        position,
      ),
    )
    .orderBy(desc(mailThreads.createdAt), mailThreads.id)
    .limit(query.limit + 1)
  return rows.map(toThreadRow)
}

export async function findVisibleThread(projectId: string, threadId: string, hiddenFolders: readonly string[]): Promise<ThreadRow | null> {
  const [row] = await getDb()
    .select(threadColumns)
    .from(mailThreads)
    .innerJoin(documents, and(eq(documents.id, mailThreads.documentId), eq(documents.projectId, mailThreads.projectId)))
    .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(and(visibleThreads(projectId, hiddenFolders), eq(mailThreads.id, threadId)))
    .limit(1)
  return row ? toThreadRow(row) : null
}

export interface EntryRow {
  entry: MailThreadEntryRow
  firstVersion: { id: string; number: number } | null
}

export async function findThreadEntries(threadId: string): Promise<EntryRow[]> {
  const rows = await getDb()
    .select({ entry: mailThreadEntries, versionId: documentVersions.id, versionNumber: documentVersions.versionNumber })
    .from(mailThreadEntries)
    .innerJoin(mailThreads, eq(mailThreads.id, mailThreadEntries.threadId))
    .leftJoin(documents, eq(documents.id, mailThreads.documentId))
    .leftJoin(
      documentVersions,
      and(eq(documentVersions.id, mailThreadEntries.firstVersionId), eq(documentVersions.documentId, documents.id)),
    )
    .where(and(eq(mailThreadEntries.threadId, threadId), or(isNull(documents.id), documentVisibleTo(SCREENED_ONLY))))
    .orderBy(mailThreadEntries.sentAt, mailThreadEntries.id)
    .limit(MAIL_THREAD_MAX_ENTRIES)
  return rows.map((row) => ({
    entry: row.entry,
    firstVersion: row.versionId && row.versionNumber !== null ? { id: row.versionId, number: row.versionNumber } : null,
  }))
}

export interface EntryAttachment {
  entryId: string
  position: number
  filename: string | null
  disposition: MailThreadAttachmentDisposition
  notFiledReason: MailThreadAttachmentNotFiledReason | null
  documentId: string | null
  documentVersionId: string | null
  document: { folderId: string | null; folderPath: string } | null
}

export async function entryAttachments(entries: readonly MailThreadEntryRow[]): Promise<EntryAttachment[]> {
  if (entries.length === 0) return []
  const rows = await getDb()
    .select({
      entryId: mailThreadEntryAttachments.entryId,
      position: mailThreadEntryAttachments.position,
      filename: mailThreadEntryAttachments.filename,
      disposition: mailThreadEntryAttachments.disposition,
      notFiledReason: mailThreadEntryAttachments.notFiledReason,
      documentId: mailThreadEntryAttachments.documentId,
      documentVersionId: mailThreadEntryAttachments.documentVersionId,
      liveDocumentId: documents.id,
      folderId: documents.folderId,
      folderPath: projectFolders.path,
    })
    .from(mailThreadEntryAttachments)
    .leftJoin(
      documents,
      and(
        eq(documents.id, mailThreadEntryAttachments.documentId),
        documentVisibleTo(SCREENED_ONLY),
        sql`(${documents.folderId} IS NULL OR NOT EXISTS (
              SELECT 1 FROM ${projectFolders} f WHERE f.id = ${documents.folderId} AND f.deleted_at IS NOT NULL))`,
      ),
    )
    .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(inArray(mailThreadEntryAttachments.entryId, entries.map((entry) => entry.id)))
    .orderBy(mailThreadEntryAttachments.entryId, mailThreadEntryAttachments.position)
    .limit(entries.length * 200)
  return rows.map((row) => ({
    entryId: row.entryId,
    position: row.position,
    filename: row.filename,
    disposition: row.disposition,
    notFiledReason: row.notFiledReason,
    documentId: row.documentId,
    documentVersionId: row.documentVersionId,
    document: row.liveDocumentId ? { folderId: row.folderId, folderPath: row.folderPath ?? '' } : null,
  }))
}

export interface MailOriginRow {
  documentVersionId: string | null
  threadId: string
  entryId: string
  sentAt: Date
  receivedAt: Date
  senderName: string | null
  authorName: string | null
  authorAddress: string | null
  signerDomain: string | null
  senderTrust: MailThreadEntryRow['senderTrust']
}

export const MAIL_ORIGINS_LIMIT = 100

export async function findMailOrigins(
  projectId: string,
  documentId: string,
  hiddenFolders: readonly string[],
): Promise<MailOriginRow[]> {
  const rows = await getDb()
    .select({
      documentVersionId: mailThreadEntryAttachments.documentVersionId,
      threadId: mailThreads.id,
      entryId: mailThreadEntries.id,
      sentAt: mailThreadEntries.sentAt,
      receivedAt: mailThreadEntries.receivedAt,
      senderName: mailThreadEntries.senderName,
      authorName: mailThreadEntries.authorName,
      authorAddress: mailThreadEntries.authorAddress,
      signerDomain: mailThreadEntries.signerDomain,
      senderTrust: mailThreadEntries.senderTrust,
    })
    .from(mailThreadEntryAttachments)
    .innerJoin(mailThreadEntries, eq(mailThreadEntries.id, mailThreadEntryAttachments.entryId))
    .innerJoin(mailThreads, eq(mailThreads.id, mailThreadEntries.threadId))
    .innerJoin(documents, and(eq(documents.id, mailThreads.documentId), eq(documents.projectId, mailThreads.projectId)))
    .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(
      and(
        eq(mailThreadEntryAttachments.projectId, projectId),
        eq(mailThreadEntryAttachments.documentId, documentId),
        inArray(mailThreadEntryAttachments.disposition, ['filed', 'already_present']),
        visibleThreads(projectId, hiddenFolders),
      ),
    )
    .orderBy(mailThreadEntries.sentAt, mailThreadEntries.id)
    .limit(MAIL_ORIGINS_LIMIT)
  return rows.map((row) => ({ ...row, sentAt: new Date(row.sentAt), receivedAt: new Date(row.receivedAt) }))
}

export async function findActiveFollows(threadIds: readonly string[]): Promise<MailThreadFollowRow[]> {
  if (threadIds.length === 0) return []
  return getDb()
    .select()
    .from(mailThreadFollows)
    .where(
      and(
        inArray(mailThreadFollows.threadId, [...threadIds]),
        isNull(mailThreadFollows.endedAt),
        sql`${mailThreadFollows.expiresAt} > now()`,
      ),
    )
    .orderBy(mailThreadFollows.createdAt)
    .limit(threadIds.length * 50)
}

export async function findWaitingForThread(projectId: string, threadId: string): Promise<{ count: number; reasons: MailThreadWaitingReason[] }> {
  const verified = sql.join(VERIFIED_SENDER_TRUSTS.map((trust) => sql`${trust}`), sql`, `)
  const reason = sql<MailThreadWaitingReason>`CASE
    WHEN ${inboundMails.senderTrust} IS NULL OR ${inboundMails.senderTrust} NOT IN (${verified}) THEN 'sender_not_verified'
    WHEN EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = inbound_mails.id AND p.kind = 'message' AND p.state = 'filed') THEN 'attachment_left'
    WHEN inbound_mails.received_at < (SELECT min(f.created_at) FROM ${mailThreadFollows} f WHERE f.thread_id = ${threadId}::uuid AND f.ended_at IS NULL) THEN 'before_follow'
    ELSE 'needs_check' END`
  const rows = await getDb()
    .select({ reason, count: sql<string>`count(*)` })
    .from(inboundMails)
    .where(
      and(
        eq(inboundMails.projectId, projectId),
        eq(inboundMails.status, 'waiting'),
        sql`${inboundMails.threadMatch} @> ${JSON.stringify([{ threadId }])}::jsonb`,
        sql`EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id} AND p.state = 'waiting')`,
      ),
    )
    .groupBy(sql`1`)
  return {
    count: rows.reduce((sum, row) => sum + Number(row.count), 0),
    reasons: MAIL_THREAD_WAITING_REASONS.filter((known) => rows.some((row) => row.reason === known)),
  }
}

const MAX_REMATCHED_MAILS = 50

export interface ThreadKeysOf {
  id: string
  baseSubject: string
  threadIndexGuid: string | null
}

export async function findWaitingMailsNearThread(projectId: string, thread: ThreadKeysOf): Promise<InboundMailRow[]> {
  const threadIds = sql`ARRAY(SELECT m.message_id FROM ${mailThreadMessageIds} m WHERE m.thread_id = ${thread.id}::uuid)`
  return getDb()
    .select()
    .from(inboundMails)
    .where(
      and(
        eq(inboundMails.projectId, projectId),
        eq(inboundMails.status, 'waiting'),
        sql`EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id} AND p.kind = 'message' AND p.state IN ('waiting', 'dismissed', 'expired'))`,
        or(
          thread.baseSubject ? eq(inboundMails.baseSubject, thread.baseSubject) : undefined,
          thread.threadIndexGuid ? eq(inboundMails.threadIndexGuid, thread.threadIndexGuid) : undefined,
          sql`${inboundMails.inReplyTo} && ${threadIds}`,
          sql`${inboundMails.referenceIds} && ${threadIds}`,
          sql`${inboundMails.threadMatch} @> ${JSON.stringify([{ threadId: thread.id }])}::jsonb`,
        ),
      ),
    )
    .orderBy(desc(inboundMails.receivedAt))
    .limit(MAX_REMATCHED_MAILS)
}

export async function recordThreadMatch(mailId: string, matches: readonly ThreadMatch[]): Promise<boolean> {
  const updated = await getDb()
    .update(inboundMails)
    .set({ threadMatch: [...matches], updatedAt: new Date() })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'waiting')))
    .returning({ id: inboundMails.id })
  return updated.length === 1
}
