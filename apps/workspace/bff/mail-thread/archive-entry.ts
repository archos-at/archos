import 'server-only'

import { v5 as uuidv5 } from 'uuid'
import type { MailImport, MailImportSkipReason } from '@/lib/db/schema/mail-imports'
import type { MailThreadEntryRow, NewMailThreadEntryAttachmentRow, NewMailThreadEntryRow } from '@/lib/db/schema/mail-thread'
import type { ArchiveMail } from '@/lib/mail-import/archive-client'
import type { MailAddress } from '@/lib/mail-import/naming'
import { cutToBytes } from './append'
import {
  baseSubject,
  clampSentAt,
  domainOf,
  matchThread,
  normalizeMessageId,
  parseInReplyTo,
  parseReferences,
  PRESELECTABLE_STRENGTHS,
  threadIndexGuid,
  type ThreadCandidate,
  type ThreadingMessage,
} from './mail-threading'
import type { MailThreadAttachmentNotFiledReason, MailThreadParticipant } from './mail-thread-wire'
import { MAIL_THREAD_ENTRY_MAX_TEXT_BYTES } from './mail-thread-vocabulary'
import { sectionAttachment } from './render'

const ARCHIVE_NAMESPACE = '8c2f4e1a-6b3d-4f5e-a7c9-0d1e2f3a4b5c'

export const archiveEntryIdOf = (importId: string, position: number): string =>
  uuidv5(`entry:${importId}:${position}`, ARCHIVE_NAMESPACE)

export const archiveThreadIdOf = (importId: string, position: number): string =>
  uuidv5(`thread:${importId}:${position}`, ARCHIVE_NAMESPACE)

export interface ArchiveMessage {
  messageId: string | null
  inReplyTo: string[]
  references: string[]
  threadIndexGuid: string | null
  baseSubject: string
  sender: MailAddress | null
  participants: MailThreadParticipant[]
  sentAt: Date
  receivedAt: Date
  ownText: string
}

function dateOf(value: string | null): Date | null {
  if (!value) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at
}

const cut = (value: string | null | undefined, max: number): string | null => (value ? value.slice(0, max) : null)

export function archiveMessageOf(mail: ArchiveMail, importedAt: Date): ArchiveMessage {
  const sent = dateOf(mail.sent_at)
  const receivedAt = dateOf(mail.received_at) ?? sent ?? importedAt
  const participants: MailThreadParticipant[] = []
  const add = (role: MailThreadParticipant['role'], address: MailAddress) => {
    const clean = address.address.trim()
    if (!clean) return
    participants.push({ role, name: cut(address.name.trim() || null, 300), address: clean.slice(0, 320) })
  }
  if (mail.sender) add('from', mail.sender)
  for (const address of mail.to) add('to', address)
  for (const address of mail.cc) add('cc', address)
  return {
    messageId: normalizeMessageId(mail.message_id),
    inReplyTo: parseInReplyTo(mail.in_reply_to),
    references: parseReferences(mail.references),
    threadIndexGuid: threadIndexGuid(mail.conversation_index),
    baseSubject: baseSubject(mail.subject),
    sender: mail.sender,
    participants: participants.slice(0, 50),
    sentAt: sent ?? receivedAt,
    receivedAt,
    ownText: cutToBytes(mail.body.text, MAIL_THREAD_ENTRY_MAX_TEXT_BYTES),
  }
}

export function threadingMessageOf(message: ArchiveMessage): ThreadingMessage {
  return {
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.references,
    threadIndexGuid: message.threadIndexGuid,
    baseSubject: message.baseSubject,
    participants: [...new Set(message.participants.map((participant) => participant.address.toLowerCase()))],
    sentAt: clampSentAt(message.sentAt, message.receivedAt).sentAt,
  }
}

export function archiveThreadMatches(message: ArchiveMessage, candidates: readonly ThreadCandidate[]): string[] {
  const strong = matchThread(threadingMessageOf(message), candidates)
    .filter((match) => PRESELECTABLE_STRENGTHS.includes(match.strength))
    .map((match) => match.threadId)
  const own = message.messageId
  const citing = own
    ? candidates
        .filter((thread) => thread.baseSubject === message.baseSubject && message.baseSubject !== '')
        .filter((thread) => thread.referencedIds.includes(own))
        .sort((a, b) => (b.lastEntryAt?.getTime() ?? 0) - (a.lastEntryAt?.getTime() ?? 0))
        .map((thread) => thread.threadId)
    : []
  return [...new Set([...strong, ...citing])]
}

export function counterpartOf(
  entry: Pick<MailThreadEntryRow, 'senderAddress' | 'senderName' | 'participants'>,
  importerEmail: string | null
): MailAddress | null {
  const own = importerEmail?.trim().toLowerCase()
  const sentByImporter = Boolean(own) && entry.senderAddress?.toLowerCase() === own
  if (sentByImporter) {
    const recipient =
      entry.participants.find((participant) => participant.role === 'to') ??
      entry.participants.find((participant) => participant.role === 'cc')
    if (recipient) return { name: recipient.name ?? '', address: recipient.address }
  }
  if (!entry.senderAddress && !entry.senderName) return null
  return { name: entry.senderName ?? '', address: entry.senderAddress ?? '' }
}

export function archiveEntryOf(input: {
  id: string
  threadId: string
  mailImport: Pick<MailImport, 'id' | 'organizationId' | 'projectId' | 'userId'>
  message: ArchiveMessage
  heading: string
  inReplyToEntryId: string | null
  filedAt: Date
}): NewMailThreadEntryRow {
  const { message, mailImport } = input
  return {
    id: input.id,
    organizationId: mailImport.organizationId,
    projectId: mailImport.projectId,
    threadId: input.threadId,
    source: 'archive',
    inboundMailId: null,
    mailImportId: mailImport.id,
    messageId: message.messageId,
    baseSubject: message.baseSubject.slice(0, 500),
    threadIndexGuid: message.threadIndexGuid,
    sentAt: message.sentAt,
    receivedAt: message.receivedAt,
    heading: input.heading,
    inReplyToEntryId: input.inReplyToEntryId,
    senderAddress: cut(message.sender?.address.trim(), 320),
    senderName: cut(message.sender?.name.trim(), 300),
    senderDomain: domainOf(message.sender?.address),
    signerDomain: null,
    senderTrust: 'not_checked',
    authenticationResults: null,
    participants: message.participants,
    ownText: message.ownText,
    maskedSpans: null,
    quoted: [],
    calendar: [],
    firstVersionId: null,
    filedBy: mailImport.userId,
    filedVia: 'archive_import',
    filedAt: input.filedAt,
  }
}

export const NOT_FILED_REASON_OF_SKIP: Readonly<Record<MailImportSkipReason, MailThreadAttachmentNotFiledReason>> = {
  embedded_message: 'unreadable',
  type: 'type_not_accepted',
  size: 'size',
  unreadable: 'unreadable',
  screened: 'screened',
  access: 'access',
  name_taken: 'name_taken',
}

export type ArchiveAttachmentOutcome =
  | {
      index: number
      filename: string
      filed: true
      documentId: string
      documentName: string
      folderId: string
    }
  | { index: number; filename: string; filed: false; reason: MailImportSkipReason }

export function archiveAttachmentRowsOf(input: {
  entryId: string
  organizationId: string
  projectId: string
  outcomes: readonly ArchiveAttachmentOutcome[]
  versions: ReadonlyMap<string, string>
  folderPaths: ReadonlyMap<string, string>
  visibleWithThread: (folderId: string) => boolean
}): NewMailThreadEntryAttachmentRow[] {
  const base = { organizationId: input.organizationId, projectId: input.projectId, entryId: input.entryId }
  return input.outcomes.map((outcome) => {
    const filename = cut(outcome.filename.trim() || null, 500)
    if (!outcome.filed) {
      return {
        ...base,
        position: outcome.index,
        filename,
        disposition: 'not_filed',
        notFiledReason: NOT_FILED_REASON_OF_SKIP[outcome.reason],
      }
    }
    const versionId = input.versions.get(outcome.documentId) ?? null
    const section = sectionAttachment({
      disposition: 'filed',
      name: outcome.documentName,
      folderPath: input.folderPaths.get(outcome.folderId) ?? null,
      visibleWithThread: versionId !== null && input.visibleWithThread(outcome.folderId),
      nameReleased: false,
    })
    return {
      ...base,
      position: outcome.index,
      filename,
      disposition: 'filed',
      notFiledReason: null,
      documentId: versionId ? outcome.documentId : null,
      documentVersionId: versionId,
      sectionName: section.name,
      sectionFolderPath: section.folderPath,
    }
  })
}
