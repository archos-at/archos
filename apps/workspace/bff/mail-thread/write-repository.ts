import 'server-only'

import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor, DbTransaction } from '@/lib/db/executor'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { inboundMailParts, inboundMails } from '@/lib/db/schema/inbound-mail'
import { mailThreadEntries, mailThreadEntryAttachments, mailThreadFollows, mailThreadMessageIds, mailThreads, type MailThreadEntryAttachmentRow, type MailThreadEntryRow, type MailThreadRow, type NewMailThreadEntryAttachmentRow, type NewMailThreadEntryRow, type NewMailThreadRow } from '@/lib/db/schema/mail-thread'
import { projectFolders } from '@/lib/db/schema/project-folders'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'
import { MAIL_THREAD_MAX_ENTRIES } from './mail-thread-vocabulary'

export async function acquireRenderLease(
  threadId: string,
  holder: string,
  until: Date
): Promise<boolean> {
  const taken = await getDb()
    .update(mailThreads)
    .set({ renderLeaseHolder: holder, renderLeaseUntil: until })
    .where(
      and(
        eq(mailThreads.id, threadId),
        or(
          isNull(mailThreads.renderLeaseUntil),
          lt(mailThreads.renderLeaseUntil, sql`now()`),
          eq(mailThreads.renderLeaseHolder, holder)
        )
      )
    )
    .returning({ id: mailThreads.id })
  return taken.length === 1
}

export async function releaseRenderLease(threadId: string, holder: string): Promise<void> {
  await getDb()
    .update(mailThreads)
    .set({ renderLeaseHolder: null, renderLeaseUntil: null })
    .where(and(eq(mailThreads.id, threadId), eq(mailThreads.renderLeaseHolder, holder)))
}

export interface WritableThread {
  thread: MailThreadRow
  document: {
    id: string
    filename: string
    folderId: string | null
    contentHash: string | null
  }
}

export async function findWritableThread(
  projectId: string,
  threadId: string,
  reader: DocumentReader
): Promise<WritableThread | null> {
  const [row] = await getDb()
    .select({
      thread: mailThreads,
      documentId: documents.id,
      filename: documents.filename,
      folderId: documents.folderId,
      contentHash: documents.contentHash,
    })
    .from(mailThreads)
    .innerJoin(
      documents,
      and(eq(documents.id, mailThreads.documentId), eq(documents.projectId, mailThreads.projectId))
    )
    .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(
      and(
        eq(mailThreads.projectId, projectId),
        eq(mailThreads.id, threadId),
        eq(documents.lifecycle, 'active'),
        documentVisibleTo(reader),
        or(isNull(documents.folderId), isNull(projectFolders.deletedAt))
      )
    )
    .limit(1)
  if (!row) return null
  return {
    thread: row.thread,
    document: {
      id: row.documentId,
      filename: row.filename,
      folderId: row.folderId,
      contentHash: row.contentHash,
    },
  }
}

export async function findThreadRow(
  projectId: string,
  threadId: string,
  executor: DbExecutor = getDb()
): Promise<MailThreadRow | null> {
  const [row] = await executor
    .select()
    .from(mailThreads)
    .where(and(eq(mailThreads.projectId, projectId), eq(mailThreads.id, threadId)))
    .limit(1)
  return row ?? null
}

export async function findThreadEntryRows(threadId: string): Promise<MailThreadEntryRow[]> {
  return getDb()
    .select()
    .from(mailThreadEntries)
    .where(eq(mailThreadEntries.threadId, threadId))
    .orderBy(mailThreadEntries.filedAt, mailThreadEntries.id)
    .limit(MAIL_THREAD_MAX_ENTRIES + 1)
}

export async function findEntryAttachmentRows(
  entryIds: readonly string[]
): Promise<Map<string, MailThreadEntryAttachmentRow[]>> {
  const byEntry = new Map<string, MailThreadEntryAttachmentRow[]>()
  if (entryIds.length === 0) return byEntry
  const rows = await getDb()
    .select()
    .from(mailThreadEntryAttachments)
    .where(inArray(mailThreadEntryAttachments.entryId, [...entryIds]))
    .orderBy(mailThreadEntryAttachments.entryId, mailThreadEntryAttachments.position)
    .limit(entryIds.length * 200)
  for (const row of rows) byEntry.set(row.entryId, [...(byEntry.get(row.entryId) ?? []), row])
  return byEntry
}

export async function findEntryOfMail(
  projectId: string,
  mailId: string
): Promise<MailThreadEntryRow | null> {
  const [row] = await getDb()
    .select()
    .from(mailThreadEntries)
    .where(
      and(eq(mailThreadEntries.projectId, projectId), eq(mailThreadEntries.inboundMailId, mailId))
    )
    .limit(1)
  return row ?? null
}

export async function isOriginalFiledByAnother(
  projectId: string,
  authorMessageId: string,
  mailId: string
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: mailThreadEntries.id })
    .from(mailThreadEntries)
    .where(
      and(
        eq(mailThreadEntries.projectId, projectId),
        eq(mailThreadEntries.authorMessageId, authorMessageId),
        or(isNull(mailThreadEntries.inboundMailId), sql`${mailThreadEntries.inboundMailId} <> ${mailId}`)
      )
    )
    .limit(1)
  return row !== undefined
}

export interface CurrentVersion {
  documentId: string
  versionId: string
  versionCreatedAt: Date
  contentHash: string | null
  folderId: string | null
}

export async function findCurrentVersions(
  documentIds: readonly string[],
  reader: DocumentReader
): Promise<Map<string, CurrentVersion>> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) return new Map()
  const rows = await getDb()
    .selectDistinctOn([documentVersions.documentId], {
      documentId: documentVersions.documentId,
      versionId: documentVersions.id,
      versionCreatedAt: documentVersions.createdAt,
      contentHash: documents.contentHash,
      folderId: documents.folderId,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(and(inArray(documentVersions.documentId, ids), documentVisibleTo(reader)))
    .orderBy(documentVersions.documentId, desc(documentVersions.versionNumber))
    .limit(ids.length)
  return new Map(
    rows.map((row) => [
      row.documentId,
      { ...row, versionCreatedAt: new Date(row.versionCreatedAt) },
    ])
  )
}

export async function findVersionTimes(
  versionIds: readonly string[],
  reader: DocumentReader
): Promise<Map<string, Date>> {
  const ids = [...new Set(versionIds)]
  if (ids.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: documentVersions.id, createdAt: documentVersions.createdAt })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(and(inArray(documentVersions.id, ids), documentVisibleTo(reader)))
    .limit(ids.length)
  return new Map(rows.map((row) => [row.id, new Date(row.createdAt)]))
}

export interface AppendCommit {
  newThread: NewMailThreadRow | null
  threadId: string
  leaseHolder: string | null
  threadUpdate: Pick<
    MailThreadRow,
    'baseSubject' | 'documentId' | 'entryCount' | 'renderedBytes' | 'lastEntryAt' | 'participantDomains'
  >
  entry: NewMailThreadEntryRow
  messageIds: { received: string | null; referenced: readonly string[] }
  attachments: readonly NewMailThreadEntryAttachmentRow[]
  part: { id: string; documentId: string; versionId: string | null }
  mailId: string
  movesOriginal: boolean
}

class AppendLost extends Error {}

export async function commitAppend(commit: AppendCommit): Promise<'committed' | 'already' | 'lost'> {
  try {
    return await getDb().transaction((tx) => writeAppend(tx, commit))
  } catch (error) {
    if (error instanceof AppendLost) return 'lost'
    throw error
  }
}

async function writeAppend(tx: DbTransaction, commit: AppendCommit): Promise<'committed' | 'already'> {
  const [existing] = await tx
    .select({ id: mailThreadEntries.id })
    .from(mailThreadEntries)
    .where(eq(mailThreadEntries.id, commit.entry.id!))
    .limit(1)
  if (existing) return 'already'
  if (commit.newThread) await tx.insert(mailThreads).values(commit.newThread)
  const updated = await tx
    .update(mailThreads)
    .set({ ...commit.threadUpdate, renderPendingAt: null })
    .where(
      and(
        eq(mailThreads.id, commit.threadId),
        commit.leaseHolder === null ? undefined : eq(mailThreads.renderLeaseHolder, commit.leaseHolder)
      )
    )
    .returning({ id: mailThreads.id })
  if (updated.length !== 1) throw new AppendLost()
  await tx.insert(mailThreadEntries).values(commit.entry)
  if (commit.entry.firstVersionId) {
    await tx
      .update(mailThreadEntries)
      .set({ firstVersionId: commit.entry.firstVersionId })
      .where(
        and(eq(mailThreadEntries.threadId, commit.threadId), isNull(mailThreadEntries.firstVersionId))
      )
  }
  await insertMessageIds(tx, commit.entry, commit.messageIds)
  if (commit.attachments.length > 0)
    await tx.insert(mailThreadEntryAttachments).values([...commit.attachments])
  const filed = await tx
    .update(inboundMailParts)
    .set({
      state: 'filed',
      claimExpiresAt: null,
      filedAt: new Date(),
      documentId: commit.part.documentId,
      documentVersionId: commit.part.versionId,
      mailThreadEntryId: commit.entry.id,
      lastFailure: null,
      suggestion: null,
      updatedAt: new Date(),
    })
    .where(and(eq(inboundMailParts.id, commit.part.id), eq(inboundMailParts.state, 'filing')))
    .returning({ id: inboundMailParts.id })
  if (filed.length !== 1) throw new AppendLost()
  if (commit.movesOriginal) {
    await tx
      .update(inboundMails)
      .set({ originalMovePendingAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(inboundMails.id, commit.mailId), sql`${inboundMails.rawStorageKey} IS NOT NULL`)
      )
  }
  return 'committed'
}

export async function insertMessageIds(
  tx: DbTransaction,
  entry: NewMailThreadEntryRow,
  ids: { received: string | null; referenced: readonly string[] }
): Promise<void> {
  const base = {
    organizationId: entry.organizationId,
    projectId: entry.projectId,
    threadId: entry.threadId,
    entryId: entry.id!,
  }
  const rows = [
    ...(ids.received ? [{ ...base, messageId: ids.received, state: 'received' as const }] : []),
    ...[...new Set(ids.referenced)]
      .filter((id) => id !== ids.received)
      .map((messageId) => ({ ...base, messageId, state: 'referenced' as const })),
  ]
  if (rows.length > 0) await tx.insert(mailThreadMessageIds).values(rows).onConflictDoNothing()
}

export async function decidePendingAttachment(
  entryId: string,
  position: number,
  outcome:
    | { disposition: 'filed' | 'already_present'; documentId: string; versionId: string | null }
    | {
        disposition: 'not_filed'
        reason: Exclude<MailThreadEntryAttachmentRow['notFiledReason'], 'pending' | null>
      }
): Promise<void> {
  await getDb()
    .update(mailThreadEntryAttachments)
    .set(
      outcome.disposition === 'not_filed'
        ? { notFiledReason: outcome.reason }
        : {
            disposition: outcome.disposition,
            notFiledReason: null,
            documentId: outcome.documentId,
            documentVersionId: outcome.versionId,
          }
    )
    .where(
      and(
        eq(mailThreadEntryAttachments.entryId, entryId),
        eq(mailThreadEntryAttachments.position, position),
        eq(mailThreadEntryAttachments.disposition, 'not_filed'),
        eq(mailThreadEntryAttachments.notFiledReason, 'pending')
      )
    )
}

export async function findEntry(
  projectId: string,
  entryId: string
): Promise<MailThreadEntryRow | null> {
  const [row] = await getDb()
    .select()
    .from(mailThreadEntries)
    .where(and(eq(mailThreadEntries.projectId, projectId), eq(mailThreadEntries.id, entryId)))
    .limit(1)
  return row ?? null
}

export async function recordEntryOriginal(
  entryId: string,
  original: Pick<
    MailThreadEntryRow,
    | 'originalBucket'
    | 'originalStorageKey'
    | 'originalSha256'
    | 'originalBytes'
    | 'originalScanStatus'
    | 'originalScannedAt'
  >
): Promise<void> {
  await getDb()
    .update(mailThreadEntries)
    .set(original)
    .where(and(eq(mailThreadEntries.id, entryId), isNull(mailThreadEntries.originalStorageKey)))
}

export async function forgetMovedRaw(mailId: string): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ rawStorageKey: null, originalMovePendingAt: null, updatedAt: new Date() })
    .where(eq(inboundMails.id, mailId))
}

export interface DetachCommit {
  entryId: string
  fromThreadId: string
  toThreadId: string
  newThread: NewMailThreadRow | null
  heading: string
  fromThreadUpdate: Pick<MailThreadRow, 'entryCount' | 'renderedBytes' | 'lastEntryAt'>
  toThreadUpdate: Pick<
    MailThreadRow,
    'documentId' | 'entryCount' | 'renderedBytes' | 'lastEntryAt' | 'participantDomains'
  >
  firstVersionId: string | null
  movedAt: Date
}

export async function commitDetach(
  commit: DetachCommit
): Promise<Array<{ id: string; userId: string }>> {
  return getDb().transaction(async (tx) => {
    if (commit.newThread) await tx.insert(mailThreads).values(commit.newThread)
    await tx
      .update(mailThreadEntries)
      .set({
        threadId: commit.toThreadId,
        heading: commit.heading,
        firstVersionId: commit.firstVersionId,
        inReplyToEntryId: null,
        filedAt: commit.movedAt,
      })
      .where(
        and(
          eq(mailThreadEntries.id, commit.entryId),
          eq(mailThreadEntries.threadId, commit.fromThreadId)
        )
      )
    await tx
      .update(mailThreadEntries)
      .set({ inReplyToEntryId: null })
      .where(
        and(
          eq(mailThreadEntries.threadId, commit.fromThreadId),
          eq(mailThreadEntries.inReplyToEntryId, commit.entryId)
        )
      )
    await tx
      .update(mailThreads)
      .set(commit.fromThreadUpdate)
      .where(eq(mailThreads.id, commit.fromThreadId))
    await tx
      .update(mailThreads)
      .set(commit.toThreadUpdate)
      .where(eq(mailThreads.id, commit.toThreadId))
    return tx
      .update(mailThreadFollows)
      .set({ endedAt: commit.movedAt, endedReason: 'detached' })
      .where(
        and(eq(mailThreadFollows.threadId, commit.fromThreadId), isNull(mailThreadFollows.endedAt))
      )
      .returning({ id: mailThreadFollows.id, userId: mailThreadFollows.userId })
  })
}
