import type { FileItem } from '@/features/documents/components/project-file-workspace'
import type { DocumentVersionListResponse } from '@/lib/documents/lifecycle-types'
import { renderMailThread, type MailThreadRenderEntry } from '@/lib/mail-thread/render'
import type { MailThreadEntryView, MailThreadView } from '@/lib/mail-thread/mail-thread-wire'
import { ENTRY_TEXTS, MAIL_THREAD_VARIANTS, PROJECT_ID, PROVENANCE_ORIGINS, versions } from '../mail-thread/fixtures'

export const MAIL_PROJECT_ID = PROJECT_ID

// A Verlauf and an attachment that came with one of its mails, as the preview opens them from Dateien: the document
// on the stage is the server's own rendition of the fixture's mails, so a change to `render.ts` shows here.

const VIEW: MailThreadView = MAIL_THREAD_VARIANTS['three-messages'].view

export const MAIL_THREAD_FILE: FileItem = {
  id: VIEW.documentId,
  filename: `${VIEW.name}.md`,
  displayName: null,
  fileSize: 3_480,
  contentType: 'text/markdown',
  status: 'ready',
  folderId: null,
  createdAt: '2026-10-02T15:20:00Z',
  errorMessage: null,
  summary: 'Abstimmung des Stellplatznachweises mit Statik und MA 37.',
  pageCount: null,
  chunkCount: 3,
  contentTypes: ['text'],
  tags: ['correspondence'],
  topics: null,
  capture: null,
  versionCount: VIEW.entries.length,
  versionState: 'published',
  mailThread: { entryCount: VIEW.entries.length, lastEntryAt: VIEW.lastEntryAt },
}

const CAME_WITH = VIEW.entries[1].attachments[0]
const ATTACHMENT_ID = CAME_WITH.documentId ?? 'dev-doc-mail-attachment'

export const MAIL_ATTACHMENT_FILE: FileItem = {
  id: ATTACHMENT_ID,
  filename: CAME_WITH.filename ?? 'S-101_B.pdf',
  displayName: null,
  fileSize: 412_000,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-10-09T09:50:00Z',
  errorMessage: null,
  summary: 'Tragwerksplan S-101, Index B: Decke über der Tiefgarage mit den Lastannahmen der Stellplätze.',
  pageCount: 2,
  chunkCount: 4,
  contentTypes: ['text'],
  tags: ['Grundriss'],
  topics: null,
  capture: null,
}

const SUBJECTS: Readonly<Record<number, string>> = {
  0: 'Stellplatznachweis',
  1: 'Stellplatznachweis – Nachreichung Statik',
  2: 'Stellungnahme MA 37 zum Stellplatznachweis',
}

function renderEntryOf(entry: MailThreadEntryView, index: number): MailThreadRenderEntry {
  return {
    id: entry.id,
    heading: entry.heading,
    source: entry.source,
    sentAt: new Date(entry.sentAt),
    receivedAt: new Date(entry.receivedAt),
    filedAt: new Date(entry.filedAt),
    senderName: entry.senderName,
    senderAddress: null,
    senderDomain: entry.senderDomain,
    signerDomain: entry.signerDomain,
    senderTrust: entry.senderTrust,
    subject: SUBJECTS[index] ?? null,
    inReplyToEntryId: index > 0 ? VIEW.entries[index - 1].id : null,
    participants: [],
    ownText: ENTRY_TEXTS[entry.id] ?? '',
    maskedSpans: null,
    quoted: [],
    calendar: [],
    attachments: entry.attachments.map((attachment) =>
      attachment.disposition !== 'not_filed' && attachment.visible && attachment.filename
        ? { name: attachment.filename, folderPath: attachment.disposition === 'filed' ? '/Pläne/Statik' : null }
        : { name: null, folderPath: null },
    ),
  }
}

export const MAIL_THREAD_MARKDOWN = renderMailThread({
  title: VIEW.name,
  locale: 'de',
  continues: null,
  entries: VIEW.entries.map(renderEntryOf),
}).markdown

export const MAIL_THREAD_VERSIONS: DocumentVersionListResponse = (() => {
  const listed = versions(VIEW.entries.length)
  return { documentId: VIEW.documentId, lifecycle: 'active', publishedVersionId: listed.at(-1)!.id, versions: listed }
})()

export const MAIL_ATTACHMENT_VERSIONS: DocumentVersionListResponse = (() => {
  const [only] = versions(1)
  const version = { ...only, id: 'ver-mail-attachment-1', documentId: ATTACHMENT_ID, contentType: 'application/pdf', mailOrigins: PROVENANCE_ORIGINS.verified }
  return { documentId: ATTACHMENT_ID, lifecycle: 'active', publishedVersionId: version.id, versions: [version] }
})()

export const MAIL_THREAD_VIEW = VIEW
