/**
 * Reading a raw message: its header block, its thread headers and
 * participants, and which of its MIME parts a person decides on (ADR-0137,
 * receive job step 5).
 *
 * `postal-mime` parses and `file-type` sniffs; this module owns only the
 * product decisions on top of them: which parts a sender meant to send, what
 * they are called, what is suspicious about them, and why the others were left
 * out. The body text is never read here (the Python reader owns it), and
 * nothing here throws: a message the parser refuses is `unreadable`, and the
 * mail still waits with its original (`readMime`).
 *
 * ## What is a part
 *
 * Every attachment postal-mime reports, whatever its disposition: Apple Mail
 * sends PDFs and text files inline, and the iPhone sends photos inline as
 * `IMG_1234.jpeg`. A text part that names itself is kept as an attachment,
 * where postal-mime would fold it into the body (`AttachmentParser`). A
 * nameless part keeps no name (`filename: null`); its extension comes from its
 * bytes when they say what it is, and the person names it when filing. A
 * forwarded message is opened {@link MAX_FORWARD_DEPTH} levels deep and its
 * parts carry `forwarded_inner`; the forward itself stays in the original.
 *
 * ## What is not staged (`NOT_STAGED_REASONS`, exact codes)
 *
 * - `embedded`: part of the message's own layout. Referenced by Content-ID
 *   from the HTML and nameless; or named the way mail clients auto-name pasted
 *   images (`image001.png`, `Outlook-….png`, `~WRL….png`); or an image under
 *   2 KiB (a tracking pixel).
 * - `tnef` (`winmail.dat`), `signature` (S/MIME `.p7s`, PGP signature),
 *   `encrypted` (S/MIME `.p7m`, anything under PGP/MIME), `calendar` (the
 *   Python reader renders an invitation into the text), `empty`.
 * - `archive`: an archive the office does not accept as a file. It is never
 *   expanded, so a zip bomb costs a sniff of its first bytes.
 * - `size`: larger than {@link MAX_PART_BYTES}. `limit`: past
 *   {@link MAX_STAGED_PARTS}, or a forward too deep or too large to open.
 *
 * ## What is flagged (`PART_RISK_FLAGS`)
 *
 * `type_not_accepted` (shown, not fileable: the office's accepted types, the
 * list the upload enforces), `type_mismatch` (the bytes contradict the name:
 * an `.exe` called `.pdf`), `encrypted` (a password-protected PDF, Office file
 * or zip), `macro` (a macro-enabled Office type, only where the office accepts
 * one) and `forwarded_inner`.
 *
 * ## Budgets
 *
 * Every pass is bounded by counted work, never by time: the header block is
 * read to {@link MAX_HEADER_BLOCK_BYTES}, a sniff sees {@link SNIFF_BYTES},
 * the parts of all forwards together stop at {@link MAX_TOTAL_PARTS}, and the
 * result reports what was done (`MimeWork`) so the hostile corpus can assert it.
 */

import { createHash } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import PostalMime, { addressParser, type Address, type Attachment, type Email } from 'postal-mime'
import { domainOf, normalizeMessageId, parseInReplyTo, parseReferences, threadIndexGuid } from '@/lib/mail-thread/mail-threading'
import { singleLine, truncateGraphemes } from '@/lib/text/graphemes'
import { uploadExtensionOf } from '@/shared/config/file-upload'
import { asciiLower } from './address'
import type { NotStagedReason, PartRiskFlag } from './contract'
import { NameLedger, safeFilename } from './mime-names'
import { ARCHIVE_EXTENSIONS, isEncryptedMessage, type MessageContext, riskFlagsOf, structuralSkip } from './mime-part-kinds'

export {
  deliveryKey,
  type HeaderField,
  headerValue,
  MAX_HEADER_BLOCK_BYTES,
  rawHeaderFields,
} from './mime-header-block'
export { safeFilename } from './mime-names'
export { MAX_PART_BYTES } from './mime-part-kinds'

/** Forwarded mails are opened this many levels deep. */
export const MAX_FORWARD_DEPTH = 3

/** Parts a person decides on, per mail. */
export const MAX_STAGED_PARTS = 100

/** Not-staged parts listed by name, per mail; the rest are only counted. */
export const MAX_NOT_STAGED_LISTED = 100

/** Every MIME part of the message and its forwards together. postal-mime's own default per parse. */
export const MAX_TOTAL_PARTS = 10_000

/** A sniff sees at most this much of a part: magic numbers and the first entries of a zip. */
export const SNIFF_BYTES = 256 * 1024

/** Participants kept, and their distinct domains. */
const MAX_PARTICIPANTS = 200
const MAX_PARTICIPANT_DOMAINS = 50

/** Display texts: a subject and a display name. */
const MAX_SUBJECT_LENGTH = 1000
const MAX_DISPLAY_NAME_LENGTH = 200

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

export interface MailMailbox {
  /** The display name, cleaned to one line, or null. Never evidence of who sent it. */
  name: string | null
  /** The address, ASCII-lowercased. */
  address: string
  /** The domain as threads compare it (`domainOf` of the thread core), or null. */
  domain: string | null
}

export type ParticipantRole = 'from' | 'sender' | 'reply_to' | 'to' | 'cc'

export interface MailParticipant extends MailMailbox {
  role: ParticipantRole
}

/** The headers the receive job stores and the thread matcher reads. */
export interface MailHeaders {
  /**
   * The thread headers, read by the thread core's own parsers
   * (`lib/mail-thread/mail-threading.ts`), so the receive job, the thread
   * tables and the archive import key messages identically: Message-ID
   * without brackets and with its domain lowercased; In-Reply-To (at most 5);
   * References (the root and the 49 most recent); Outlook's Thread-Index
   * conversation GUID.
   */
  messageId: string | null
  inReplyTo: string[]
  references: string[]
  threadIndexGuid: string | null
  /** The subject as a person reads it: one line, cut between graphemes. Prefixes are kept. */
  subject: string | null
  /** The Date header, or null when it is missing or not a date. Unclamped; see `clampSentAt`. */
  sentAtHeader: Date | null
  /** The single From mailbox, or null when there is none or more than one. */
  from: MailMailbox | null
  /** From, Sender, Reply-To, To and Cc, at most {@link MAX_PARTICIPANTS}. */
  participants: MailParticipant[]
  /** The distinct domains of the participants, at most {@link MAX_PARTICIPANT_DOMAINS}. */
  participantDomains: string[]
  /** How many addresses To and Cc name, counted before any cap. */
  recipientCount: number
}

/** One part a person decides on. */
export interface MailAttachment {
  /** 1-based, in message order. */
  position: number
  /** A name safe to file under, distinct within the mail, or null when the part named none. */
  filename: string | null
  /** The extension the upload reads (`.pdf`), from the name or else from the bytes; null when neither says. */
  extension: string | null
  /** The Content-Type as sent, lowercased. Never trusted. */
  declaredType: string
  /** What `file-type` found, or null. */
  sniffedType: string | null
  size: number
  /** Hex SHA-256 of `content`. */
  sha256: string
  content: Uint8Array
  riskFlags: PartRiskFlag[]
  /** 0 for the mail's own parts, n for a part of an n-level forward. */
  forwardDepth: number
}

/** A part that was not staged, and why. Its bytes are in the original. */
export interface NotStagedPart {
  filename: string | null
  reason: NotStagedReason
  size: number
}

/** Counted work, so a budget can be asserted without a clock. */
export interface MimeWork {
  /** Messages parsed: the mail and each forward opened. */
  messagesParsed: number
  /** Attachments postal-mime reported, across all of them. */
  partsVisited: number
  /** `file-type` calls. */
  sniffs: number
  /** Bytes handed to `file-type`. */
  bytesSniffed: number
  /** Bytes hashed for staged parts. */
  bytesHashed: number
}

/** Why a message could not be read at all. The mail still waits, with its original. */
export type UnreadableReason = 'header_size' | 'nesting' | 'part_count' | 'addresses' | 'malformed'

export type MimeRead =
  | {
      kind: 'read'
      headers: MailHeaders
      attachments: MailAttachment[]
      notStaged: NotStagedPart[]
      /** Not-staged parts past {@link MAX_NOT_STAGED_LISTED}, counted only. */
      notStagedOverflow: number
      work: MimeWork
    }
  | { kind: 'unreadable'; reason: UnreadableReason; work: MimeWork }

export interface MimeReadOptions {
  /** The office's accepted extensions, lowercased with the dot (`acceptedTypesForOrganization`). */
  acceptedTypes: readonly string[]
}

/** The part of postal-mime's MIME node the text hook reads. Internal to postal-mime, hence restated. */
interface MimeNodeHeaders {
  contentType?: { parsed?: { value?: string; params?: Record<string, string | undefined> } }
  contentDisposition?: { parsed?: { value?: string; params?: Record<string, string | undefined> } }
}

/**
 * postal-mime folds every text/plain and text/html part that is not
 * `disposition=attachment` into the body, so an inline `Massenliste.txt`
 * would vanish. It has no option for that; its `isInlineTextNode` hook
 * (internal, present in 3.x and 4.x) decides, and this override keeps a text
 * part that names itself as an attachment. `mime.spec.ts` fails if an upgrade
 * stops calling it.
 */
class AttachmentParser extends PostalMime {
  isInlineTextNode(node: MimeNodeHeaders): boolean {
    const type = node.contentType?.parsed?.value
    if (node.contentDisposition?.parsed?.value === 'attachment') return false
    if (type !== 'text/plain' && type !== 'text/html') return false
    return !(node.contentDisposition?.parsed?.params?.filename || node.contentType?.parsed?.params?.name)
  }
}

/** Thrown when the part budget across forwards is spent, so the forward is `limit` rather than the mail `unreadable`. */
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

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** A Date header as a time, or null when it is not one. */
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

/**
 * The From mailboxes, from every From field: postal-mime's `from` keeps only
 * the first address of the first field, which would hide a second author.
 */
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

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

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
    // A sniffer error is no verdict about the bytes; the scan and the upload still look at them.
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
    declaredType: attachment.mimeType.toLowerCase(),
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
    // A forward postal-mime refuses is still in the original; the mail itself is readable.
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

/**
 * Read a raw RFC 5322 message: its headers and the parts a person decides on.
 * Never throws: what postal-mime refuses (nesting, header size, part count)
 * is `unreadable` with the reason, and the receive job keeps the mail waiting
 * with a message part whose original can be downloaded once it is scanned.
 */
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
