import 'server-only'

import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds, projectMayWriteDocuments } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { MailThreadFollowRow } from '@/lib/db/schema/mail-thread'
import { decodeDocumentListCursor, encodeDocumentListCursor } from '@/lib/documents/list-cursor'
import { managesProject, requireInboundMailEnabled } from '@/lib/inbound-mail/access'
import { followView } from './follows'
import type {
  MailThreadAttachmentView,
  MailThreadEntryView,
  MailThreadListQuery,
  MailThreadListView,
  MailThreadSummaryView,
  MailThreadView,
} from './mail-thread-wire'
import {
  findWaitingForThread,
  entryAttachments,
  findActiveFollows,
  findThreadEntries,
  findVisibleThread,
  listVisibleThreads,
  type EntryAttachment,
  type EntryRow,
  type ThreadRow,
} from './repository'

async function requireThreadReader(session: AuthorizedSession, projectId: string): Promise<string[]> {
  requireInboundMailEnabled(session)
  await requireProjectAccess(session, projectId, 'project:view')
  return getHiddenFolderIds(session, projectId)
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString())

function summaryView(thread: ThreadRow, follows: readonly MailThreadFollowRow[], userId: string): MailThreadSummaryView {
  return {
    id: thread.id,
    documentId: thread.documentId,
    name: thread.name,
    entryCount: thread.entryCount,
    lastEntryAt: iso(thread.lastEntryAt),
    followed: follows.some((follow) => follow.threadId === thread.id && follow.userId === userId),
  }
}

export function attachmentViews(attachments: readonly EntryAttachment[], hiddenFolders: ReadonlySet<string>): MailThreadAttachmentView[] {
  return attachments.map((attachment) => {
    const filed = attachment.disposition !== 'not_filed'
    const folderId = attachment.document?.folderId ?? null
    const visible = !filed || (attachment.document !== null && (folderId === null || !hiddenFolders.has(folderId)))
    if (!visible) return { position: attachment.position, filename: null, disposition: attachment.disposition, visible: false }
    return {
      position: attachment.position,
      filename: filed ? attachment.filename : null,
      disposition: attachment.disposition,
      ...(attachment.notFiledReason ? { notFiledReason: attachment.notFiledReason } : {}),
      ...(attachment.documentId ? { documentId: attachment.documentId } : {}),
      ...(attachment.documentVersionId ? { documentVersionId: attachment.documentVersionId } : {}),
      visible: true,
    }
  })
}

function entryView(row: EntryRow, attachments: MailThreadAttachmentView[]): MailThreadEntryView {
  const { entry } = row
  return {
    id: entry.id,
    heading: entry.heading,
    source: entry.source,
    senderName: entry.senderName,
    senderDomain: entry.senderDomain,
    signerDomain: entry.signerDomain,
    senderTrust: entry.senderTrust,
    forwardedBy: entry.authorName || entry.authorAddress ? { name: entry.senderName, domain: entry.signerDomain ?? entry.senderDomain } : null,
    sentAt: new Date(entry.sentAt).toISOString(),
    receivedAt: new Date(entry.receivedAt).toISOString(),
    firstVersion: row.firstVersion,
    original: entry.originalStorageKey ? { scanStatus: entry.originalScanStatus ?? 'pending' } : null,
    attachments,
    filedBy: entry.filedBy,
    filedVia: entry.filedVia,
    filedAt: new Date(entry.filedAt).toISOString(),
  }
}


export async function listMailThreads(
  session: AuthorizedSession,
  projectId: string,
  query: MailThreadListQuery,
): Promise<MailThreadListView> {
  const hidden = await requireThreadReader(session, projectId)
  const decoded = query.cursor ? decodeDocumentListCursor(query.cursor) : null
  if (query.cursor && !decoded) throw new BadRequestError('Invalid cursor')
  const rows = await listVisibleThreads(
    projectId,
    hidden,
    { documentId: query.documentId, limit: query.limit },
    decoded ? { createdAt: decoded.createdAt, id: decoded.id } : null,
  )
  const page = rows.slice(0, query.limit)
  const follows = await findActiveFollows(page.map((thread) => thread.id))
  const last = page.at(-1)
  return {
    items: page.map((thread) => summaryView(thread, follows, session.userId)),
    nextCursor: rows.length > query.limit && last ? encodeDocumentListCursor({ createdAt: last.createdAtText, id: last.id }) : null,
  }
}

async function waitingOf(mayFile: boolean, projectId: string, threadId: string): Promise<Pick<MailThreadView, 'waitingCount' | 'waitingReasons'>> {
  if (!mayFile) return { waitingCount: null, waitingReasons: [] }
  const waiting = await findWaitingForThread(projectId, threadId)
  return { waitingCount: waiting.count, waitingReasons: waiting.reasons }
}

export async function getMailThread(session: AuthorizedSession, projectId: string, threadId: string): Promise<MailThreadView> {
  const hidden = await requireThreadReader(session, projectId)
  const thread = await findVisibleThread(projectId, threadId, hidden)
  if (!thread) throw new NotFoundError('Mail thread not found')
  const [entries, follows, mayFile, managesFollows] = await Promise.all([
    findThreadEntries(thread.id),
    findActiveFollows([thread.id]),
    projectMayWriteDocuments(session, projectId),
    managesProject(session, projectId),
  ])
  const attachments = await entryAttachments(entries.map((row) => row.entry))
  const hiddenSet = new Set(hidden)
  return {
    ...summaryView(thread, follows, session.userId),
    participantDomains: thread.participantDomains,
    continuesThreadId: thread.continuesThreadId,
    entries: entries.map((row) =>
      entryView(
        row,
        attachmentViews(
          attachments.filter((attachment) => attachment.entryId === row.entry.id),
          hiddenSet,
        ),
      ),
    ),
    follows: follows.map(followView),
    managesFollows,
    ...(await waitingOf(mayFile, projectId, thread.id)),
  }
}
