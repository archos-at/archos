import 'server-only'

import { v5 as uuidv5 } from 'uuid'
import {
  ApiError,
  BadRequestError,
  ConflictError,
  FileTooLargeError,
  ForbiddenError,
  InsufficientStorageError,
  NotFoundError,
} from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AccessFolder } from '@/lib/authz/folder-access-rule'
import type { InboundMailDecisionRow, InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import type { MailThreadEntryRow, NewMailThreadEntryRow } from '@/lib/db/schema/mail-thread'
import { contentDigest } from '@/lib/documents/content-digest'
import { memberReader } from '@/lib/documents/document-reader'
import { documentNameKey } from '@/lib/documents/name-match'
import { uploadDocument } from '@/lib/documents/document-dispatch'
import type { IngestPriority } from '@/lib/documents/ingest-dispatch'
import { THREAD_DOCUMENT_TYPE } from '@/lib/inbound-mail/decision'
import type { InboundMailFilingFailure } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { MailRead } from '@/lib/inbound-mail/read-client'
import { findDocumentIdByStoredName, findLiveFolders } from '@/lib/inbound-mail/repository'
import { ensureProjectFolderPaths } from '@/lib/projects/folder-service'
import { isProjectClosedError } from '@/lib/projects/project-status'
import { findSpans, maskText, type ContentScreenRules } from '@/lib/upload-screening/content-screen'
import { ScreenedUploadError } from '@/lib/upload-screening/service'
import { attachmentRowsOf, cut, readableWithThread, sectionLineOf, type AttachmentFact } from './attachment-rows'
import { mailThreadIngestFacts, type MailThreadIngestFacts } from './ingest-facts'
import { clampSentAt, domainOf } from './mail-threading'
import {
  mailThreadCalendarEventSchema,
  mailThreadMaskedSpanSchema,
  mailThreadParticipantSchema,
  mailThreadQuoteSchema,
  type MailThreadCalendarEvent,
  type MailThreadMaskedSpan,
  type MailThreadQuote,
  type MailThreadSectionAttachment,
} from './mail-thread-wire'
import {
  MAIL_THREAD_ENTRY_MAX_TEXT_BYTES,
  MAIL_THREAD_MAX_ENTRIES,
  MAIL_THREAD_MAX_RENDERED_BYTES,
  type MailThreadLocale,
} from './mail-thread-vocabulary'
import {
  mailThreadEntryHeading,
  renderMailThread,
  type MailThreadRenderEntry,
} from './render'
import {
  acquireRenderLease,
  commitAppend,
  findCurrentVersions,
  findEntryAttachmentRows,
  findThreadEntryRows,
  findWritableThread,
  isOriginalFiledByAnother,
  releaseRenderLease,
  type WritableThread,
} from './write-repository'

export {
  attachmentRowsOf,
  readableWithThread,
  readRestrictionsAt,
  sectionLineOf,
  type AttachmentFact,
} from './attachment-rows'

export const RENDER_LEASE_MS = 5 * 60 * 1000

export const RENDER_LEASE_RETRY_MS = 15 * 1000

const APPEND_NAMESPACE = '3f0b8d6e-5c2a-4e7b-9a14-6d2e8c0f1b73'

export const entryIdOf = (decisionId: string): string =>
  uuidv5(`entry:${decisionId}`, APPEND_NAMESPACE)

export const newThreadIdOf = (decisionId: string): string =>
  uuidv5(`thread:${decisionId}`, APPEND_NAMESPACE)

export function threadDocumentFilename(name: string): string {
  const clean = documentNameKey(name)
  return /\.md$/i.test(clean) ? clean : `${clean}.md`
}

export function threadTitleOf(filename: string): string {
  return filename.replace(/\.md$/i, '')
}

export function cutToBytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  return new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/�$/, '')
}

function calendarEventOf(event: MailRead['calendar'][number]): MailThreadCalendarEvent {
  const utc = (value: string | null) => {
    if (!value) return null
    const at = new Date(value)
    return Number.isNaN(at.getTime()) ? null : at.toISOString()
  }
  return {
    method: cut(event.method, 40),
    summary: cut(event.summary, 500),
    start: utc(event.start),
    end: utc(event.end),
    allDay: event.allDay,
    location: cut(event.location, 500),
    status: cut(event.status, 40),
  }
}

export interface MessageForm {
  masked: boolean
  rules: ContentScreenRules | null
}

export function inboundEntryOf(input: {
  id: string
  threadId: string
  mail: InboundMailRow
  read: MailRead
  decision: InboundMailDecisionRow
  heading: string
  inReplyToEntryId: string | null
  form: MessageForm
}): NewMailThreadEntryRow {
  const { mail, read, decision, form } = input
  const ownText = cutToBytes(read.ownText, MAIL_THREAD_ENTRY_MAX_TEXT_BYTES)
  const spans: MailThreadMaskedSpan[] | null =
    form.masked && form.rules
      ? findSpans(ownText, form.rules).map(({ kind, start, end }) => ({ kind, start, end }))
      : null
  const quoted: MailThreadQuote[] = read.quoted.map((quote) => ({
    text: form.masked && form.rules ? maskText(quote.text, form.rules).text : quote.text,
  }))
  return {
    id: input.id,
    organizationId: mail.organizationId,
    projectId: mail.projectId,
    threadId: input.threadId,
    source: 'inbound',
    inboundMailId: mail.id,
    messageId: mail.messageId,
    baseSubject: mail.baseSubject?.slice(0, 500) ?? null,
    threadIndexGuid: mail.threadIndexGuid,
    sentAt: mail.sentAt ?? mail.receivedAt,
    receivedAt: mail.receivedAt,
    heading: input.heading,
    inReplyToEntryId: input.inReplyToEntryId,
    senderAddress: cut(mail.senderAddress, 320),
    senderName: cut(mail.senderName, 300),
    senderDomain: domainOf(mail.senderAddress),
    signerDomain: mail.signerDomain,
    senderTrust: mail.senderTrust ?? 'external_unverified',
    authenticationResults: mail.authenticationResults,
    ...authorOf(mail),
    participants: mail.participants
      .slice(0, 50)
      .map((participant) => ({ ...participant, name: cut(participant.name, 300) })),
    ownText,
    maskedSpans: spans && spans.length > 0 ? spans : null,
    quoted,
    calendar: read.calendar.map(calendarEventOf),
    firstVersionId: null,
    filedBy: decision.decidedBy,
    filedVia: decision.via,
    filedAt: decision.decidedAt,
  }
}

function authorOf(mail: InboundMailRow): Pick<NewMailThreadEntryRow, 'authorAddress' | 'authorName' | 'authorSentAt' | 'authorMessageId'> {
  if (!mail.originalAuthorAddress && !mail.originalAuthorName) return {}
  return {
    authorAddress: mail.originalAuthorAddress,
    authorName: mail.originalAuthorName,
    authorSentAt: mail.originalSentAt,
    authorMessageId: mail.originalMessageId,
  }
}

async function originalFiledBefore(mail: InboundMailRow): Promise<boolean> {
  if (!mail.originalMessageId) return false
  return isOriginalFiledByAnother(mail.projectId, mail.originalMessageId, mail.id)
}

function asForwardersOwn(mail: InboundMailRow): InboundMailRow {
  return { ...mail, originalAuthorAddress: null, originalAuthorName: null, originalSentAt: null, originalMessageId: null }
}

export function answeredEntryOf(
  entries: ReadonlyArray<Pick<MailThreadEntryRow, 'id' | 'messageId' | 'filedAt'>>,
  inReplyTo: readonly string[]
): string | null {
  const wanted = new Set(inReplyTo)
  const answered = entries.filter((entry) => entry.messageId && wanted.has(entry.messageId))
  answered.sort((a, b) => new Date(b.filedAt).getTime() - new Date(a.filedAt).getTime())
  return answered[0]?.id ?? null
}

export function renderEntryOf(
  row: NewMailThreadEntryRow | MailThreadEntryRow,
  attachments: readonly MailThreadSectionAttachment[]
): MailThreadRenderEntry {
  return {
    id: row.id!,
    heading: row.heading,
    source: row.source,
    sentAt: new Date(row.sentAt),
    receivedAt: new Date(row.receivedAt),
    filedAt: new Date(row.filedAt ?? 0),
    senderName: row.senderName ?? null,
    senderAddress: row.senderAddress ?? null,
    senderDomain: row.senderDomain ?? null,
    signerDomain: row.signerDomain ?? null,
    senderTrust: row.senderTrust,
    author:
      row.authorName || row.authorAddress
        ? { name: row.authorName ?? null, address: row.authorAddress ?? null, sentAt: row.authorSentAt ? new Date(row.authorSentAt) : null }
        : null,
    inReplyToEntryId: row.inReplyToEntryId ?? null,
    participants: mailThreadParticipantSchema
      .array()
      .max(50)
      .parse(row.participants ?? []),
    ownText: row.ownText ?? '',
    maskedSpans: row.maskedSpans
      ? mailThreadMaskedSpanSchema.array().max(1000).parse(row.maskedSpans)
      : null,
    quoted: mailThreadQuoteSchema
      .array()
      .max(50)
      .parse(row.quoted ?? []),
    calendar: mailThreadCalendarEventSchema
      .array()
      .max(20)
      .parse(row.calendar ?? []),
    attachments,
  }
}

export async function renderEntriesOf(
  rows: readonly MailThreadEntryRow[]
): Promise<MailThreadRenderEntry[]> {
  const attachments = await findEntryAttachmentRows(rows.map((row) => row.id))
  return rows.map((row) => renderEntryOf(row, (attachments.get(row.id) ?? []).map(sectionLineOf)))
}

export interface ThreadVersionUpload {
  session: AuthorizedSession
  projectId: string
  folderId: string | null
  filename: string
  markdown: string
  facts: MailThreadIngestFacts
  current: WritableThread['document'] | null
  screeningRelease: boolean
  uploadBatchId: string | null
  priority?: IngestPriority
  request: Request
}

export type ThreadVersionResult =
  | { ok: true; documentId: string; versionId: string | null }
  | { ok: false; failure: InboundMailFilingFailure }

export async function uploadThreadVersion(upload: ThreadVersionUpload): Promise<ThreadVersionResult> {
  const bytes = Buffer.from(upload.markdown, 'utf8')
  const digest = contentDigest(bytes)
  const reader = memberReader(upload.session.userId)
  const documentId = upload.current?.id ?? null
  if (!documentId) {
    const holder = await findDocumentIdByStoredName(upload.projectId, upload.filename)
    if (holder) {
      const held = (await findCurrentVersions([holder], reader)).get(holder)
      if (held?.contentHash !== digest) return { ok: false, failure: 'name_taken' }
      return { ok: true, documentId: holder, versionId: held.versionId }
    }
  } else if (upload.current?.contentHash === digest) {
    return {
      ok: true,
      documentId,
      versionId:
        (await findCurrentVersions([documentId], reader)).get(documentId)?.versionId ?? null,
    }
  }

  const uploaded = await uploadOrFailure(() =>
    uploadDocument(
      upload.session,
      {
        projectId: upload.projectId,
        folderId: upload.folderId,
        file: new File([bytes], upload.filename, { type: 'text/markdown' }),
        screeningRelease: upload.screeningRelease,
        uploadBatchId: upload.uploadBatchId,
        ...(upload.priority ? { priority: upload.priority } : {}),
        documentType: THREAD_DOCUMENT_TYPE,
        mailThread: upload.facts,
      },
      upload.request
    )
  )
  if (!uploaded.ok) return uploaded
  const stored = uploaded.value.documentId
  return {
    ok: true,
    documentId: stored,
    versionId: (await findCurrentVersions([stored], reader)).get(stored)?.versionId ?? null,
  }
}

export async function uploadOrFailure<T>(
  run: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failure: InboundMailFilingFailure }> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    const failure = filingFailureOf(error)
    if (failure) return { ok: false, failure }
    throw error
  }
}

export function filingFailureOf(error: unknown): InboundMailFilingFailure | null {
  if (!(error instanceof ApiError)) return null
  if (error instanceof ScreenedUploadError) return 'screened'
  if (error instanceof FileTooLargeError) return 'size'
  if (error instanceof InsufficientStorageError) return 'quota'
  if (isProjectClosedError(error)) return 'project_closed'
  if (error instanceof ForbiddenError || error instanceof NotFoundError) return 'access'
  if (error instanceof ConflictError) return 'name_taken'
  if (error instanceof BadRequestError) return 'type'
  return null
}

export async function ensureTargetFolder(
  session: AuthorizedSession,
  projectId: string,
  target: { folderId: string | null; folderPath: string | null }
): Promise<
  { ok: true; folderId: string | null } | { ok: false; failure: InboundMailFilingFailure }
> {
  if (target.folderId) {
    const live = await findLiveFolders(projectId, [target.folderId])
    return live.has(target.folderId)
      ? { ok: true, folderId: target.folderId }
      : { ok: false, failure: 'access' }
  }
  if (!target.folderPath) return { ok: true, folderId: null }
  const path = target.folderPath
  try {
    const ensured = await ensureProjectFolderPaths(
      { projectId, parentId: null, paths: [path] },
      session
    )
    const folderId = ensured.ok ? ensured.folderIdByPath[path] : undefined
    return folderId ? { ok: true, folderId } : { ok: false, failure: 'access' }
  } catch (error) {
    const failure = filingFailureOf(error)
    if (failure) return { ok: false, failure }
    throw error
  }
}

export interface AppendRequest {
  session: AuthorizedSession
  mail: InboundMailRow
  part: InboundMailPartRow
  decision: InboundMailDecisionRow
  read: MailRead
  form: MessageForm
  attachments: readonly AttachmentFact[]
  folderTree: ReadonlyMap<string, AccessFolder>
  newThreadFolderId: string | null
  newThreadLocale: MailThreadLocale
  uploadBatchId: string | null
  request: Request
}

export type AppendOutcome =
  | {
      kind: 'filed'
      entryId: string
      threadId: string
      documentId: string
      versionId: string | null
    }
  | { kind: 'failed'; failure: InboundMailFilingFailure }
  | { kind: 'busy' }

export async function appendInboundMessage(request: AppendRequest): Promise<AppendOutcome> {
  const { decision } = request
  if (decision.threadAction === 'append' && decision.mailThreadId) {
    const threadId = decision.mailThreadId
    if (!(await acquireRenderLease(threadId, decision.id, new Date(Date.now() + RENDER_LEASE_MS))))
      return { kind: 'busy' }
    try {
      const target = await findWritableThread(
        request.mail.projectId,
        threadId,
        memberReader(request.session.userId)
      )
      if (!target) return { kind: 'failed', failure: 'thread_document_gone' }
      return await appendTo(request, { kind: 'existing', target })
    } finally {
      await releaseRenderLease(threadId, decision.id)
    }
  }
  if (decision.threadAction === 'create' && decision.fileName) {
    return appendTo(request, {
      kind: 'new',
      threadId: newThreadIdOf(decision.id),
      filename: threadDocumentFilename(decision.fileName),
    })
  }
  throw new Error(`decision ${decision.id} files a mail text without a thread`)
}

type AppendTarget =
  { kind: 'existing'; target: WritableThread } | { kind: 'new'; threadId: string; filename: string }

async function appendTo(request: AppendRequest, target: AppendTarget): Promise<AppendOutcome> {
  const { mail, decision } = request
  const threadId = target.kind === 'existing' ? target.target.thread.id : target.threadId
  const locale = target.kind === 'existing' ? target.target.thread.locale : request.newThreadLocale
  const filename = target.kind === 'existing' ? target.target.document.filename : target.filename
  const threadFolderId =
    target.kind === 'existing' ? target.target.document.folderId : request.newThreadFolderId

  const rows = target.kind === 'existing' ? await findThreadEntryRows(threadId) : []
  if (rows.length >= MAIL_THREAD_MAX_ENTRIES) return { kind: 'failed', failure: 'size' }
  const earlier = await renderEntriesOf(rows)

  const entryId = entryIdOf(decision.id)
  const unheaded = inboundEntryOf({
    id: entryId,
    threadId,
    mail: (await originalFiledBefore(mail)) ? asForwardersOwn(mail) : mail,
    read: request.read,
    decision,
    heading: '',
    inReplyToEntryId: answeredEntryOf(rows, mail.inReplyTo),
    form: request.form,
  })
  const entry = {
    ...unheaded,
    heading: mailThreadEntryHeading(
      renderEntryOf(unheaded, []),
      rows.map((row) => row.heading),
      locale
    ),
  }
  const attachments = attachmentRowsOf({
    entryId,
    organizationId: mail.organizationId,
    projectId: mail.projectId,
    receivedAt: new Date(mail.receivedAt),
    facts: request.attachments,
    notStaged: mail.notStaged,
    visibleWithThread: (folderId) =>
      readableWithThread(request.folderTree, folderId, threadFolderId),
  })
  const lines = attachments.map((row) =>
    sectionLineOf({
      sectionName: row.sectionName ?? null,
      sectionFolderPath: row.sectionFolderPath ?? null,
    })
  )
  const entries = [...earlier, renderEntryOf(entry, lines)]
  const rendition = renderMailThread({
    title: threadTitleOf(filename),
    locale,
    continues: null,
    entries,
  })
  if (rendition.bytes > MAIL_THREAD_MAX_RENDERED_BYTES) return { kind: 'failed', failure: 'size' }

  const uploaded = await uploadThreadVersion({
    session: request.session,
    projectId: mail.projectId,
    folderId: threadFolderId,
    filename,
    markdown: rendition.markdown,
    facts: mailThreadIngestFacts(entries, locale),
    current: target.kind === 'existing' ? target.target.document : null,
    screeningRelease: target.kind === 'new' && decision.screeningRelease,
    uploadBatchId: request.uploadBatchId,
    request: request.request,
  })
  if (!uploaded.ok) return { kind: 'failed', failure: uploaded.failure }

  const thread = target.kind === 'existing' ? target.target.thread : null
  const lastEntryAt = new Date(
    Math.max(...entries.map((row) => clampSentAt(row.sentAt, row.receivedAt).sentAt.getTime()))
  )
  const participantDomains = [
    ...new Set([...(thread?.participantDomains ?? []), ...mail.participantDomains]),
  ].slice(0, 200)
  const committed = await commitAppend({
    threadId,
    leaseHolder: target.kind === 'existing' ? decision.id : null,
    newThread:
      target.kind === 'new'
        ? {
            id: threadId,
            organizationId: mail.organizationId,
            projectId: mail.projectId,
            documentId: uploaded.documentId,
            baseSubject: (mail.baseSubject ?? '').slice(0, 500),
            threadIndexGuid: mail.threadIndexGuid,
            participantDomains,
            locale,
            createdBy: decision.decidedBy,
          }
        : null,
    threadUpdate: {
      baseSubject: mail.baseSubject ? mail.baseSubject.slice(0, 500) : (thread?.baseSubject ?? ''),
      documentId: uploaded.documentId,
      entryCount: entries.length,
      renderedBytes: rendition.bytes,
      lastEntryAt,
      participantDomains,
    },
    entry: { ...entry, firstVersionId: uploaded.versionId },
    messageIds: { received: mail.messageId, referenced: [...mail.inReplyTo, ...mail.referenceIds] },
    attachments,
    part: { id: request.part.id, documentId: uploaded.documentId, versionId: uploaded.versionId },
    mailId: mail.id,
    movesOriginal: mail.rawStorageKey !== null,
  })
  if (committed === 'lost') return { kind: 'busy' }
  return {
    kind: 'filed',
    entryId,
    threadId,
    documentId: uploaded.documentId,
    versionId: uploaded.versionId,
  }
}
