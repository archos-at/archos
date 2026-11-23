import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import { canWriteFolder } from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import type { AccessFolder } from '@/lib/authz/folder-access-rule'
import type { MailImport, MailImportSkipReason } from '@/lib/db/schema/mail-imports'
import type { MailThreadEntryRow, MailThreadRow } from '@/lib/db/schema/mail-thread'
import { memberReader } from '@/lib/documents/document-reader'
import type { InboundMailFilingFailure } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { findThreadCandidates } from '@/lib/inbound-mail/repository'
import type { ArchiveMail } from '@/lib/mail-import/archive-client'
import { archiveThreadName, numbered } from '@/lib/mail-import/naming'
import {
  answeredEntryOf,
  readableWithThread,
  RENDER_LEASE_MS,
  RENDER_LEASE_RETRY_MS,
  renderEntriesOf,
  renderEntryOf,
  threadDocumentFilename,
  threadTitleOf,
  uploadThreadVersion,
} from './append'
import {
  commitArchiveEntry,
  commitArchiveRender,
  findArchiveEntry,
  findEntryWithMessageId,
  findPendingThreadsOfImport,
  giveUpPendingRender,
  importWroteInto,
  threadHoldingDocument,
} from './archive-repository'
import {
  archiveAttachmentRowsOf,
  archiveEntryIdOf,
  archiveEntryOf,
  archiveMessageOf,
  archiveThreadIdOf,
  archiveThreadMatches,
  counterpartOf,
  threadingMessageOf,
  type ArchiveAttachmentOutcome,
  type ArchiveMessage,
} from './archive-entry'
import { mailThreadIngestFacts } from './ingest-facts'
import { clampSentAt, domainOf } from './mail-threading'
import type { MailThreadParticipant } from './mail-thread-wire'
import {
  MAIL_THREAD_MAX_ENTRIES,
  MAIL_THREAD_MAX_RENDERED_BYTES,
  type MailThreadLocale,
} from './mail-thread-vocabulary'
import { rematchAfterWrite } from './rematch'
import { mailThreadEntryHeading, renderMailThread } from './render'
import { MAIL_THREAD_RENDER_COPY } from './render-copy'
import {
  acquireRenderLease,
  findCurrentVersions,
  findThreadEntryRows,
  findThreadRow,
  findWritableThread,
  releaseRenderLease,
} from './write-repository'

export {
  archiveAttachmentRowsOf,
  archiveEntryIdOf,
  archiveEntryOf,
  archiveMessageOf,
  archiveThreadIdOf,
  archiveThreadMatches,
  counterpartOf,
  NOT_FILED_REASON_OF_SKIP,
  threadingMessageOf,
  type ArchiveAttachmentOutcome,
  type ArchiveMessage,
} from './archive-entry'

const MAX_THREAD_NAME_ATTEMPTS = 50

const RENDERED_BYTES_MARGIN = 1024

const LONGEST_TITLE = 'x'.repeat(260)

const LEASE_POLL_MS = 1_000

export interface ArchiveFiling {
  session: AuthorizedSession
  mailImport: Pick<MailImport, 'id' | 'organizationId' | 'projectId' | 'userId' | 'userEmail' | 'createdAt'>
  archiveFolderId: string
  holder: string
  locale: MailThreadLocale
  folderTree: FolderTree
  request: Request
}

export type ArchiveEntryOutcome =
  | { kind: 'already_in_project' }
  | {
      kind: 'filed'
      threadId: string
      threadCreated: boolean
      threadJoined: boolean
    }
  | { kind: 'busy' }

export class FolderTree {
  private tree: ReadonlyMap<string, AccessFolder> | null = null

  constructor(
    private readonly organizationId: string,
    private readonly projectId: string
  ) {}

  async covering(folderIds: readonly (string | null)[]): Promise<ReadonlyMap<string, AccessFolder>> {
    const wanted = folderIds.filter((id): id is string => id !== null)
    if (!this.tree || wanted.some((id) => !this.tree!.has(id))) {
      const folders = await listProjectFolderTree(this.organizationId, this.projectId)
      this.tree = new Map(folders.map((folder): [string, AccessFolder] => [folder.id, folder]))
    }
    return this.tree
  }
}

export interface ArchiveMailFolder {
  id: string
  path: string
}

export async function appendArchiveEntry(
  filing: ArchiveFiling,
  mail: ArchiveMail,
  attachments: { outcomes: readonly ArchiveAttachmentOutcome[]; folder: ArchiveMailFolder | null }
): Promise<ArchiveEntryOutcome> {
  const { mailImport } = filing
  const entryId = archiveEntryIdOf(mailImport.id, mail.position)
  const createdThreadId = archiveThreadIdOf(mailImport.id, mail.position)

  const own = await findArchiveEntry(mailImport.projectId, entryId)
  if (own) return filedOutcome(filing, own.threadId, createdThreadId, entryId)

  const message = archiveMessageOf(mail, new Date(mailImport.createdAt))
  if (message.messageId && (await findEntryWithMessageId(mailImport.projectId, message.messageId, entryId))) {
    return { kind: 'already_in_project' }
  }

  const candidates = await findThreadCandidates(
    mailImport.projectId,
    {
      messageIds: [message.messageId, ...message.inReplyTo, ...message.references].filter(
        (id): id is string => id !== null
      ),
      threadIndexGuid: message.threadIndexGuid,
      baseSubject: message.baseSubject,
      participants: threadingMessageOf(message).participants,
    },
    { pendingOfImport: mailImport.id }
  )
  for (const threadId of archiveThreadMatches(message, candidates)) {
    const joined = await joinThread(filing, threadId, { entryId, message, attachments })
    if (joined === 'busy') return { kind: 'busy' }
    if (joined === 'committed') return filedOutcome(filing, threadId, createdThreadId, entryId)
  }

  await commitEntry(filing, {
    threadId: createdThreadId,
    newThread: true,
    threadFolderId: filing.archiveFolderId,
    earlier: [],
    entryId,
    message,
    attachments,
  })
  return filedOutcome(filing, createdThreadId, createdThreadId, entryId)
}

async function filedOutcome(
  filing: ArchiveFiling,
  threadId: string,
  createdThreadId: string,
  entryId: string
): Promise<ArchiveEntryOutcome> {
  const threadCreated = threadId === createdThreadId
  const threadJoined = !threadCreated && !(await importWroteInto(threadId, filing.mailImport.id, entryId))
  return { kind: 'filed', threadId, threadCreated, threadJoined }
}

interface PendingEntry {
  entryId: string
  message: ArchiveMessage
  attachments: { outcomes: readonly ArchiveAttachmentOutcome[]; folder: ArchiveMailFolder | null }
}

async function joinThread(
  filing: ArchiveFiling,
  threadId: string,
  pending: PendingEntry
): Promise<'committed' | 'ineligible' | 'busy'> {
  if (!(await waitForLease(threadId, filing.holder))) return 'busy'
  try {
    const target = await writableTarget(filing, threadId)
    if (!target) return 'ineligible'
    const earlier = await findThreadEntryRows(threadId)
    if (earlier.length >= MAIL_THREAD_MAX_ENTRIES) return 'ineligible'
    const fits = await commitEntry(filing, {
      threadId,
      newThread: false,
      threadFolderId: target.folderId,
      title: target.title,
      earlier,
      ...pending,
    })
    return fits ? 'committed' : 'ineligible'
  } finally {
    await releaseRenderLease(threadId, filing.holder)
  }
}

async function writableTarget(
  filing: ArchiveFiling,
  threadId: string
): Promise<{ folderId: string | null; title: string } | null> {
  const { session, mailImport } = filing
  const thread = await findThreadRow(mailImport.projectId, threadId)
  if (!thread) return null
  if (!thread.documentId) return thread.renderPendingAt ? { folderId: filing.archiveFolderId, title: LONGEST_TITLE } : null
  const writable = await findWritableThread(mailImport.projectId, threadId, memberReader(session.userId))
  if (!writable) return null
  if (!(await canWriteFolder(session, mailImport.projectId, writable.document.folderId))) return null
  return { folderId: writable.document.folderId, title: threadTitleOf(writable.document.filename) }
}

async function waitForLease(threadId: string, holder: string): Promise<boolean> {
  const giveUpAt = Date.now() + RENDER_LEASE_RETRY_MS
  for (;;) {
    if (await acquireRenderLease(threadId, holder, new Date(Date.now() + RENDER_LEASE_MS))) return true
    if (Date.now() + LEASE_POLL_MS > giveUpAt) return false
    await new Promise((resolve) => setTimeout(resolve, LEASE_POLL_MS))
  }
}

async function commitEntry(
  filing: ArchiveFiling,
  input: PendingEntry & {
    threadId: string
    newThread: boolean
    threadFolderId: string | null
    title?: string
    earlier: readonly MailThreadEntryRow[]
  }
): Promise<boolean> {
  const { mailImport, session } = filing
  const { message } = input
  const locale = input.newThread ? filing.locale : await threadLocale(mailImport.projectId, input.threadId, filing.locale)
  const unheaded = archiveEntryOf({
    id: input.entryId,
    threadId: input.threadId,
    mailImport,
    message,
    heading: '',
    inReplyToEntryId: answeredEntryOf(input.earlier, message.inReplyTo),
    filedAt: new Date(),
  })
  const entry = {
    ...unheaded,
    heading: mailThreadEntryHeading(
      renderEntryOf(unheaded, []),
      input.earlier.map((row) => row.heading),
      locale
    ),
  }

  const outcomes = input.attachments.outcomes
  const filedDocuments = outcomes.flatMap((outcome) => (outcome.filed ? [outcome.documentId] : []))
  const versions = await currentVersionIds(filedDocuments, session.userId)
  const tree = await filing.folderTree.covering([input.threadFolderId, input.attachments.folder?.id ?? null])
  const rows = archiveAttachmentRowsOf({
    entryId: input.entryId,
    organizationId: mailImport.organizationId,
    projectId: mailImport.projectId,
    outcomes,
    versions,
    folderPaths: new Map(input.attachments.folder ? [[input.attachments.folder.id, input.attachments.folder.path]] : []),
    visibleWithThread: (folderId) => readableWithThread(tree, folderId, input.threadFolderId),
  })

  if (!input.newThread) {
    const earlier = await renderEntriesOf(input.earlier)
    const lines = rows.map((row) => ({ name: row.sectionName ?? null, folderPath: row.sectionFolderPath ?? null }))
    const rendition = renderMailThread({
      title: input.title ?? LONGEST_TITLE,
      locale,
      continues: null,
      entries: [...earlier, renderEntryOf(entry, lines)],
    })
    if (rendition.bytes + RENDERED_BYTES_MARGIN > MAIL_THREAD_MAX_RENDERED_BYTES) return false
  }

  await commitArchiveEntry({
    newThread: input.newThread
      ? {
          id: input.threadId,
          organizationId: mailImport.organizationId,
          projectId: mailImport.projectId,
          documentId: null,
          baseSubject: message.baseSubject.slice(0, 500),
          threadIndexGuid: message.threadIndexGuid,
          participantDomains: participantDomainsOf(message.participants),
          locale,
          createdBy: mailImport.userId,
        }
      : null,
    entry,
    messageIds: { received: message.messageId, referenced: [...message.inReplyTo, ...message.references] },
    attachments: rows,
  })
  return true
}

async function threadLocale(projectId: string, threadId: string, fallback: MailThreadLocale): Promise<MailThreadLocale> {
  return (await findThreadRow(projectId, threadId))?.locale ?? fallback
}

async function currentVersionIds(documentIds: readonly string[], userId: string): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map()
  const current = await findCurrentVersions(documentIds, memberReader(userId))
  return new Map([...current].map(([documentId, version]) => [documentId, version.versionId]))
}

function participantDomainsOf(participants: readonly MailThreadParticipant[], known: readonly string[] = []): string[] {
  const domains = new Set(known)
  for (const participant of participants) {
    const domain = domainOf(participant.address)
    if (domain) domains.add(domain)
  }
  return [...domains].slice(0, 200)
}

export interface ArchiveRenderSkip {
  name: string
  reason: MailImportSkipReason
}

export interface ArchiveRenderResult {
  rendered: number
  waiting: number
  skipped: ArchiveRenderSkip[]
  quotaFull: boolean
}

export interface ArchiveRenderTarget {
  uploadBatchId: () => Promise<string>
  counted: () => void
  deadline: number
}

export async function renderPendingThreads(
  filing: ArchiveFiling,
  target: ArchiveRenderTarget
): Promise<ArchiveRenderResult> {
  const result: ArchiveRenderResult = { rendered: 0, waiting: 0, skipped: [], quotaFull: false }
  for (const thread of await findPendingThreadsOfImport(filing.mailImport.id)) {
    if (result.quotaFull || Date.now() >= target.deadline) {
      result.waiting += 1
      continue
    }
    if (!(await acquireRenderLease(thread.id, filing.holder, new Date(Date.now() + RENDER_LEASE_MS)))) {
      result.waiting += 1
      continue
    }
    try {
      const outcome = await renderThread(filing, thread.id, target)
      if (outcome.kind === 'rendered') result.rendered += 1
      if (outcome.kind === 'skipped') result.skipped.push(outcome.skip)
      if (outcome.kind === 'quota') result.quotaFull = true
    } finally {
      await releaseRenderLease(thread.id, filing.holder)
    }
  }
  return result
}

type ThreadRender =
  | { kind: 'rendered' }
  | { kind: 'nothing' }
  | { kind: 'skipped'; skip: ArchiveRenderSkip }
  | { kind: 'quota' }

async function renderThread(filing: ArchiveFiling, threadId: string, target: ArchiveRenderTarget): Promise<ThreadRender> {
  const { mailImport, session } = filing
  const thread = await findThreadRow(mailImport.projectId, threadId)
  if (!thread?.renderPendingAt) return { kind: 'nothing' }
  const rows = await findThreadEntryRows(threadId)
  if (rows.length === 0) {
    await giveUpPendingRender(threadId)
    return { kind: 'nothing' }
  }
  const entries = await renderEntriesOf(rows)

  let current: Awaited<ReturnType<typeof findWritableThread>> = null
  if (thread.documentId) {
    current = await findWritableThread(mailImport.projectId, threadId, memberReader(session.userId))
    if (!current) {
      await giveUpPendingRender(threadId)
      return { kind: 'nothing' }
    }
  }
  const names = current ? [current.document.filename] : newThreadFilenames(thread, rows, filing.mailImport.userEmail)

  for (const filename of names) {
    const rendition = renderMailThread({ title: threadTitleOf(filename), locale: thread.locale, continues: null, entries })
    if (rendition.bytes > MAIL_THREAD_MAX_RENDERED_BYTES) {
      await giveUpPendingRender(threadId)
      return { kind: 'skipped', skip: { name: threadTitleOf(filename), reason: 'size' } }
    }
    const uploaded = await uploadThreadVersion({
      session,
      projectId: mailImport.projectId,
      folderId: current ? current.document.folderId : filing.archiveFolderId,
      filename,
      markdown: rendition.markdown,
      facts: mailThreadIngestFacts(entries, thread.locale),
      current: current?.document ?? null,
      screeningRelease: false,
      uploadBatchId: await target.uploadBatchId(),
      priority: 'bulk',
      request: filing.request,
    })
    if (uploaded.ok && !current && (await threadHoldingDocument(uploaded.documentId, threadId))) {
      continue
    }
    if (uploaded.ok) {
      target.counted()
      await commitArchiveRender({
        threadId,
        documentId: uploaded.documentId,
        versionId: uploaded.versionId,
        entryCount: entries.length,
        renderedBytes: rendition.bytes,
        lastEntryAt: new Date(
          Math.max(...entries.map((entry) => clampSentAt(entry.sentAt, entry.receivedAt).sentAt.getTime()))
        ),
        participantDomains: current
          ? thread.participantDomains
          : participantDomainsOf(rows.flatMap((row) => row.participants), thread.participantDomains),
      })
      await rematchAfterWrite(mailImport.projectId, [thread])
      return { kind: 'rendered' }
    }
    if (uploaded.failure === 'name_taken' && !current) continue
    if (uploaded.failure === 'quota') return { kind: 'quota' }
    await giveUpPendingRender(threadId)
    return { kind: 'skipped', skip: { name: threadTitleOf(filename), reason: skipReasonOf(uploaded.failure) } }
  }
  await giveUpPendingRender(threadId)
  return { kind: 'skipped', skip: { name: threadTitleOf(names[0] ?? ''), reason: 'name_taken' } }
}

function newThreadFilenames(thread: MailThreadRow, rows: readonly MailThreadEntryRow[], importerEmail: string | null): string[] {
  const first = rows[0]
  const at = clampSentAt(new Date(first.sentAt), new Date(first.receivedAt)).sentAt
  const base = archiveThreadName(counterpartOf(first, importerEmail), at, MAIL_THREAD_RENDER_COPY[thread.locale].unknownSender)
  return Array.from({ length: MAX_THREAD_NAME_ATTEMPTS }, (_, index) =>
    threadDocumentFilename(numbered(base, index + 1))
  )
}

function skipReasonOf(failure: InboundMailFilingFailure): MailImportSkipReason {
  switch (failure) {
    case 'screened':
      return 'screened'
    case 'size':
      return 'size'
    case 'type':
    case 'type_not_accepted':
      return 'type'
    case 'name_taken':
      return 'name_taken'
    default:
      return 'access'
  }
}
