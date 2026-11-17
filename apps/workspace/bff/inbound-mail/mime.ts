import { createHash } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import PostalMime, { addressParser, type Address, type Attachment, type Email } from 'postal-mime'
import { domainOf, normalizeMessageId, parseInReplyTo, parseReferences, threadIndexGuid } from '@/lib/mail-thread/mail-threading'
import { singleLine, truncateGraphemes } from '@/lib/text/graphemes'
import { uploadExtensionOf } from '@/shared/config/file-upload'
import { asciiLower } from './address'
import type { NotStagedReason, PartRiskFlag } from './contract'
import { NameLedger, safeFilename, safeMediaType } from './mime-names'
import { ARCHIVE_EXTENSIONS, isEncryptedMessage, type MessageContext, riskFlagsOf, structuralSkip } from './mime-part-kinds'

export {
  deliveryKey,
  type HeaderField,
  headerValue,
  MAX_HEADER_BLOCK_BYTES,
  rawHeaderFields,
} from './mime-header-block'
export { safeFilename, safeMediaType } from './mime-names'
export { MAX_PART_BYTES } from './mime-part-kinds'

export const MAX_FORWARD_DEPTH = 3

export const MAX_STAGED_PARTS = 100

export const MAX_NOT_STAGED_LISTED = 100

export const MAX_TOTAL_PARTS = 10_000

export const SNIFF_BYTES = 256 * 1024

const MAX_PARTICIPANTS = 200
const MAX_PARTICIPANT_DOMAINS = 50

const MAX_SUBJECT_LENGTH = 1000
const MAX_DISPLAY_NAME_LENGTH = 200

export interface MailMailbox {
  name: string | null
  address: string
  domain: string | null
}

export type ParticipantRole = 'from' | 'sender' | 'reply_to' | 'to' | 'cc'

export interface MailParticipant extends MailMailbox {
  role: ParticipantRole
}

export interface MailHeaders {
  messageId: string | null
  inReplyTo: string[]
  references: string[]
  threadIndexGuid: string | null
  subject: string | null
  sentAtHeader: Date | null
  from: MailMailbox | null
  participants: MailParticipant[]
  participantDomains: string[]
  recipientCount: number
}

export interface MailAttachment {
  position: number
  filename: string | null
  extension: string | null
  declaredType: string
  sniffedType: string | null
  size: number
  sha256: string
  content: Uint8Array
  riskFlags: PartRiskFlag[]
  forwardDepth: number
}

export interface NotStagedPart {
  filename: string | null
  reason: NotStagedReason
  size: number
}

export interface MimeWork {
  messagesParsed: number
  partsVisited: number
  sniffs: number
  bytesSniffed: number
  bytesHashed: number
}

export type UnreadableReason = 'header_size' | 'nesting' | 'part_count' | 'addresses' | 'malformed'

export type MimeRead =
  | {
      kind: 'read'
      headers: MailHeaders
      attachments: MailAttachment[]
      notStaged: NotStagedPart[]
      notStagedOverflow: number
      work: MimeWork
    }
  | { kind: 'unreadable'; reason: UnreadableReason; work: MimeWork }

export interface MimeReadOptions {
  acceptedTypes: readonly string[]
}

interface MimeNodeHeaders {
  contentType?: { parsed?: { value?: string; params?: Record<string, string | undefined> } }
  contentDisposition?: { parsed?: { value?: string; params?: Record<string, string | undefined> } }
}

class AttachmentParser extends PostalMime {
  isInlineTextNode(node: MimeNodeHeaders): boolean {
    const type = node.contentType?.parsed?.value
    if (node.contentDisposition?.parsed?.value === 'attachment') return false
    if (type !== 'text/plain' && type !== 'text/html') return false
    return !(node.contentDisposition?.parsed?.params?.filename || node.contentType?.parsed?.params?.name)
  }
}

class PartBudgetSpent extends Error {}

function newWork(): MimeWork {
  return { messagesParsed: 0, partsVisited: 0, sniffs: 0, bytesSniffed: 0, bytesHashed: 0 }
}

function unreadableReason(error: unknown): UnreadableReason {
  const code = error instanceof Error && 'code' in error ? String(error.code) : ''
  if (code === 'EMAXHEADERSIZE') return 'header_size'
  if (code === 'EMAXNESTINGDEPTH') return 'nesting'
  if (code === 'EMAXPARTCOUNT') return 'part_count'
  if (code === 'EMAXFORWARDEDADDRESSES') return 'addresses'
  return 'malformed'
}

async function parseMessage(raw: Uint8Array, maxPartCount: number, work: MimeWork): Promise<Email> {
  work.messagesParsed += 1
  const parser = new AttachmentParser({
    forceRfc822Attachments: true,
    attachmentEncoding: 'arraybuffer',
    maxPartCount,
    maxRfc822NestingDepth: 0,
  })
  return parser.parse(raw)
}

function toBytes(content: Attachment['content']): Uint8Array {
  if (typeof content === 'string') return new Uint8Array(Buffer.from(content))
  return content instanceof ArrayBuffer ? new Uint8Array(content) : content
}

export function parseDateHeader(value: string | null | undefined): Date | null {
  if (!value) return null
  const time = Date.parse(value.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim())
  if (Number.isNaN(time)) return null
  const date = new Date(time)
  const year = date.getUTCFullYear()
  return year >= 1970 && year <= 9999 ? date : null
}

function mailboxesOf(addresses: readonly Address[] | Address | undefined): MailMailbox[] {
  const list = addresses === undefined ? [] : Array.isArray(addresses) ? addresses : [addresses]
  return list
    .flatMap((entry) => (entry.group ? entry.group : [entry]))
    .flatMap((mailbox) => {
      const address = asciiLower(singleLine(mailbox.address ?? ''))
      if (!address) return []
      const name = truncateGraphemes(singleLine(mailbox.name ?? ''), MAX_DISPLAY_NAME_LENGTH)
      return [{ name: name || null, address, domain: domainOf(address) }]
    })
}

function fromMailboxes(email: Email): MailMailbox[] {
  return email.headers
    .filter((header) => header.key === 'from')
    .flatMap((header) => mailboxesOf(addressParser(header.value, { flatten: true })))
}

function readHeaders(email: Email): MailHeaders {
  const fromBoxes = fromMailboxes(email)
  const to = mailboxesOf(email.to)
  const cc = mailboxesOf(email.cc)
  const roles: [ParticipantRole, MailMailbox[]][] = [
    ['from', fromBoxes],
    ['sender', mailboxesOf(email.sender)],
    ['reply_to', mailboxesOf(email.replyTo)],
    ['to', to],
    ['cc', cc],
  ]
  const participants = roles
    .flatMap(([role, boxes]) => boxes.map((box) => ({ ...box, role })))
    .slice(0, MAX_PARTICIPANTS)
  const domains = [...new Set(participants.flatMap((participant) => (participant.domain ? [participant.domain] : [])))]
  const threadIndex = email.headers.find((header) => header.key === 'thread-index')?.value
  const subject = truncateGraphemes(singleLine(email.subject ?? ''), MAX_SUBJECT_LENGTH, '…')
  return {
    messageId: normalizeMessageId(email.messageId),
    inReplyTo: parseInReplyTo(email.inReplyTo),
    references: parseReferences(email.references),
    threadIndexGuid: threadIndexGuid(threadIndex),
    subject: subject || null,
    sentAtHeader: parseDateHeader(email.headers.find((header) => header.key === 'date')?.value),
    from: fromBoxes.length === 1 ? fromBoxes[0] : null,
    participants,
    participantDomains: domains.slice(0, MAX_PARTICIPANT_DOMAINS),
    recipientCount: to.length + cc.length,
  }
}

interface Selection {
  accepted: ReadonlySet<string>
  attachments: MailAttachment[]
  notStaged: NotStagedPart[]
  notStagedOverflow: number
  names: NameLedger
  work: MimeWork
}

function sha256(bytes: Uint8Array, work: MimeWork): string {
  work.bytesHashed += bytes.byteLength
  return createHash('sha256').update(bytes).digest('hex')
}

function skip(selection: Selection, filename: string | null, reason: NotStagedReason, size: number): void {
  if (selection.notStaged.length >= MAX_NOT_STAGED_LISTED) {
    selection.notStagedOverflow += 1
    return
  }
  selection.notStaged.push({ filename, reason, size })
}

async function sniff(bytes: Uint8Array, work: MimeWork): Promise<string | null> {
  const window = bytes.subarray(0, Math.min(bytes.byteLength, SNIFF_BYTES))
  work.sniffs += 1
  work.bytesSniffed += window.byteLength
  try {
    return (await fileTypeFromBuffer(window))?.ext ?? null
  } catch {
    return null
  }
}

async function selectPart(attachment: Attachment, context: MessageContext, selection: Selection): Promise<void> {
  const bytes = toBytes(attachment.content)
  const name = safeFilename(attachment.filename ?? '')
  const shown = name || null
  const reason = structuralSkip(attachment, name, bytes.byteLength, context)
  if (reason) return skip(selection, shown, reason, bytes.byteLength)
  if (selection.attachments.length >= MAX_STAGED_PARTS) return skip(selection, shown, 'limit', bytes.byteLength)

  const sniffed = await sniff(bytes, selection.work)
  const extension = (name ? uploadExtensionOf(name) : '') || (sniffed ? `.${sniffed}` : '') || null
  const isArchive = extension !== null && ARCHIVE_EXTENSIONS.has(extension)
  if (isArchive && !selection.accepted.has(extension)) return skip(selection, shown, 'archive', bytes.byteLength)

  const digest = sha256(bytes, selection.work)
  const filename = name ? selection.names.claim(name, digest) : null
  if (name && filename === null) return
  if (!name && !selection.names.claimNameless(digest)) return
  selection.attachments.push({
    position: selection.attachments.length + 1,
    filename,
    extension,
    declaredType: safeMediaType(attachment.mimeType),
    sniffedType: sniffed,
    size: bytes.byteLength,
    sha256: digest,
    content: bytes,
    riskFlags: riskFlagsOf(bytes, extension, sniffed, selection.accepted, context.depth),
    forwardDepth: context.depth,
  })
}

async function selectForward(attachment: Attachment, depth: number, selection: Selection): Promise<void> {
  const bytes = toBytes(attachment.content)
  const shown = safeFilename(attachment.filename ?? '') || null
  const remaining = MAX_TOTAL_PARTS - selection.work.partsVisited
  if (depth >= MAX_FORWARD_DEPTH || remaining <= 1) return skip(selection, shown, 'limit', bytes.byteLength)
  let forwarded: Email
  try {
    forwarded = await parseMessage(bytes, remaining, selection.work)
  } catch {
    return skip(selection, shown, 'limit', bytes.byteLength)
  }
  await selectFrom(forwarded, depth + 1, selection)
}

async function selectFrom(email: Email, depth: number, selection: Selection): Promise<void> {
  const context: MessageContext = { encrypted: isEncryptedMessage(email), depth }
  for (const attachment of email.attachments) {
    selection.work.partsVisited += 1
    if (selection.work.partsVisited > MAX_TOTAL_PARTS) throw new PartBudgetSpent()
    if (attachment.mimeType.toLowerCase() === 'message/rfc822' && !context.encrypted) {
      await selectForward(attachment, depth, selection)
    } else {
      await selectPart(attachment, context, selection)
    }
  }
}

export async function readMime(raw: Uint8Array, options: MimeReadOptions): Promise<MimeRead> {
  const work = newWork()
  let email: Email
  try {
    email = await parseMessage(raw, MAX_TOTAL_PARTS, work)
  } catch (error) {
    return { kind: 'unreadable', reason: unreadableReason(error), work }
  }
  const selection: Selection = {
    accepted: new Set(options.acceptedTypes.map((type) => type.toLowerCase())),
    attachments: [],
    notStaged: [],
    notStagedOverflow: 0,
    names: new NameLedger(),
    work,
  }
  try {
    await selectFrom(email, 0, selection)
  } catch (error) {
    if (!(error instanceof PartBudgetSpent)) return { kind: 'unreadable', reason: 'malformed', work }
    selection.notStagedOverflow += 1
  }
  return {
    kind: 'read',
    headers: readHeaders(email),
    attachments: selection.attachments,
    notStaged: selection.notStaged,
    notStagedOverflow: selection.notStagedOverflow,
    work,
  }
}
