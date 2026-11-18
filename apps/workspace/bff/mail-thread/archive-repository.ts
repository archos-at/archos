import 'server-only'

import { and, eq, exists, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { mailThreadEntries, mailThreadEntryAttachments, mailThreads, type MailThreadRow, type NewMailThreadEntryAttachmentRow, type NewMailThreadEntryRow, type NewMailThreadRow } from '@/lib/db/schema/mail-thread'
import { insertMessageIds } from './write-repository'

export const ARCHIVE_PENDING_THREADS_LIMIT = 200

export async function findEntryWithMessageId(
  projectId: string,
  messageId: string,
  exceptEntryId: string
): Promise<{ entryId: string; threadId: string } | null> {
  const [row] = await getDb()
    .select({ entryId: mailThreadEntries.id, threadId: mailThreadEntries.threadId })
    .from(mailThreadEntries)
    .innerJoin(mailThreads, eq(mailThreads.id, mailThreadEntries.threadId))
    .where(
      and(
        eq(mailThreadEntries.projectId, projectId),
        eq(mailThreadEntries.messageId, messageId),
        ne(mailThreadEntries.id, exceptEntryId),
        or(isNotNull(mailThreads.documentId), isNotNull(mailThreads.renderPendingAt))
      )
    )
    .limit(1)
  return row ?? null
}

export async function findArchiveEntry(
  projectId: string,
  entryId: string
): Promise<{ id: string; threadId: string } | null> {
  const [row] = await getDb()
    .select({ id: mailThreadEntries.id, threadId: mailThreadEntries.threadId })
    .from(mailThreadEntries)
    .where(and(eq(mailThreadEntries.projectId, projectId), eq(mailThreadEntries.id, entryId)))
    .limit(1)
  return row ?? null
}

export async function importWroteInto(
  threadId: string,
  importId: string,
  exceptEntryId: string
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: mailThreadEntries.id })
    .from(mailThreadEntries)
    .where(
      and(
        eq(mailThreadEntries.threadId, threadId),
        eq(mailThreadEntries.mailImportId, importId),
        ne(mailThreadEntries.id, exceptEntryId)
      )
    )
    .limit(1)
  return Boolean(row)
}

export interface ArchiveEntryCommit {
  newThread: NewMailThreadRow | null
  entry: NewMailThreadEntryRow
  messageIds: { received: string | null; referenced: readonly string[] }
  attachments: readonly NewMailThreadEntryAttachmentRow[]
}

export async function commitArchiveEntry(commit: ArchiveEntryCommit): Promise<'committed' | 'already'> {
  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: mailThreadEntries.id })
      .from(mailThreadEntries)
      .where(eq(mailThreadEntries.id, commit.entry.id!))
      .limit(1)
    if (existing) return 'already'
    if (commit.newThread) await tx.insert(mailThreads).values(commit.newThread).onConflictDoNothing()
    await tx.insert(mailThreadEntries).values(commit.entry)
    await insertMessageIds(tx, commit.entry, commit.messageIds)
    if (commit.attachments.length > 0) await tx.insert(mailThreadEntryAttachments).values([...commit.attachments])
    await tx
      .update(mailThreads)
      .set({ renderPendingAt: sql`coalesce(${mailThreads.renderPendingAt}, now())` })
      .where(eq(mailThreads.id, commit.entry.threadId))
    return 'committed'
  })
}

export async function findPendingThreadsOfImport(
  importId: string,
  limit = ARCHIVE_PENDING_THREADS_LIMIT
): Promise<MailThreadRow[]> {
  return getDb()
    .select()
    .from(mailThreads)
    .where(
      and(
        isNotNull(mailThreads.renderPendingAt),
        exists(
          getDb()
            .select({ one: sql`1` })
            .from(mailThreadEntries)
            .where(
              and(eq(mailThreadEntries.threadId, mailThreads.id), eq(mailThreadEntries.mailImportId, importId))
            )
        )
      )
    )
    .orderBy(mailThreads.renderPendingAt, mailThreads.id)
    .limit(limit)
}

export interface ArchiveRenderCommit {
  threadId: string
  documentId: string
  versionId: string | null
  entryCount: number
  renderedBytes: number
  lastEntryAt: Date
  participantDomains: string[]
}

export async function commitArchiveRender(commit: ArchiveRenderCommit): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx
      .update(mailThreads)
      .set({
        documentId: commit.documentId,
        entryCount: commit.entryCount,
        renderedBytes: commit.renderedBytes,
        lastEntryAt: commit.lastEntryAt,
        participantDomains: commit.participantDomains,
        renderPendingAt: null,
      })
      .where(eq(mailThreads.id, commit.threadId))
    if (commit.versionId) {
      await tx
        .update(mailThreadEntries)
        .set({ firstVersionId: commit.versionId })
        .where(and(eq(mailThreadEntries.threadId, commit.threadId), isNull(mailThreadEntries.firstVersionId)))
    }
  })
}

export async function giveUpPendingRender(threadId: string): Promise<void> {
  await getDb().update(mailThreads).set({ renderPendingAt: null }).where(eq(mailThreads.id, threadId))
}

export async function threadHoldingDocument(documentId: string, threadId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: mailThreads.id })
    .from(mailThreads)
    .where(and(eq(mailThreads.documentId, documentId), ne(mailThreads.id, threadId)))
    .limit(1)
  return Boolean(row)
}
