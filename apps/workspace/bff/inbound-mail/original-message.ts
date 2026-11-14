/**
 * Who wrote a forwarded mail, when and to whom: the ORIGINAL message, as
 * opposed to the forward that carried it to the project.
 *
 * A colleague forwards the Behörde's mail to the project. The mail's sender is
 * the colleague (who filed it, kept for the audit trail); the reader and every
 * citation want the Behörde (who wrote it). Two places say so, in this order:
 *
 * 1. **An attached original** (Outlook „Als Anlage weiterleiten“, Apple Mail
 *    „Als Anhang weiterleiten“): a `message/rfc822` part or an `.eml` file. Its
 *    header block is the original's own, so it wins. Read with postal-mime, the
 *    parser the receive path already uses (`./mime`).
 * 2. **An inline forward**: the header block a mail program writes into the
 *    body („-----Ursprüngliche Nachricht----- Von: … Gesendet: …“, „Begin
 *    forwarded message:“, Gmail's „---------- Forwarded message ---------“), in
 *    German or English. Read with `email-forward-parser` (crisp-oss, MIT,
 *    maintained), which knows the clients and both languages; the classic
 *    Outlook separator it lacks is handled here. Its dates are the client's
 *    words („Montag, 3. November 2026 10:15“), read with `chrono-node` in the
 *    office's time zone, because a forward's date line carries no zone.
 *
 * Nothing here is verified: a forward's header block is text the forwarder's
 * program wrote, and the forwarder could have edited it. It names the author
 * for attribution, never for trust; trust is the forwarder's (DKIM/DMARC).
 *
 * Pure apart from parsing; never throws.
 */

import PostalMime, { type Address, type Attachment } from 'postal-mime'
import EmailForwardParser, { type EmailForwardMailbox } from 'email-forward-parser'
import * as chrono from 'chrono-node'
import { OFFICE_TIME_ZONE } from '@/lib/format'

export interface OriginalMailbox {
  name: string | null
  address: string | null
}

export interface OriginalMessage {
  /** Where it was read from: an attached original is authoritative, an inline block is the forwarder's text. */
  source: 'attachment' | 'inline'
  from: OriginalMailbox | null
  to: OriginalMailbox[]
  cc: OriginalMailbox[]
  subject: string | null
  /** When the original was sent, or null when no date could be read. */
  sentAt: Date | null
  /** The date as the mail program wrote it, kept beside the parsed one. */
  sentAtText: string | null
  /** The original's Message-ID (an attached original only: an inline block has none). */
  messageId: string | null
}

/** Attached originals read at most; a mail forwarding more is attributed by its first. */
const MAX_ATTACHED_ORIGINALS = 3

/** The original of a forwarded mail, or null when the mail carries none. */
export async function originalMessage(raw: Uint8Array, outerSubject: string | null): Promise<OriginalMessage | null> {
  try {
    const outer = await PostalMime.parse(raw, { forceRfc822Attachments: true, attachmentEncoding: 'arraybuffer' })
    const attached = await attachedOriginal(outer.attachments)
    if (attached) return attached
    return inlineOriginal(outer.text ?? htmlToPlainText(outer.html ?? ''), outerSubject ?? outer.subject ?? null)
  } catch {
    return null
  }
}

/** The first attachment that is a whole message, read as one. */
async function attachedOriginal(attachments: readonly Attachment[]): Promise<OriginalMessage | null> {
  const originals = attachments.filter(isAttachedMessage).slice(0, MAX_ATTACHED_ORIGINALS)
  for (const attachment of originals) {
    const parsed = await PostalMime.parse(attachment.content as ArrayBuffer).catch(() => null)
    if (!parsed?.from) continue
    return {
      source: 'attachment',
      from: mailboxOf(parsed.from),
      to: (parsed.to ?? []).flatMap(mailboxesOf),
      cc: (parsed.cc ?? []).flatMap(mailboxesOf),
      subject: parsed.subject ?? null,
      sentAt: parsed.date ? validDate(new Date(parsed.date)) : null,
      sentAtText: parsed.date ?? null,
      messageId: parsed.messageId ?? null,
    }
  }
  return null
}

function isAttachedMessage(attachment: Attachment): boolean {
  if (attachment.mimeType.toLowerCase() === 'message/rfc822') return true
  return /\.eml$/i.test(attachment.filename ?? '') && /octet-stream|rfc822/i.test(attachment.mimeType)
}

/** The classic Outlook separator, which `email-forward-parser` does not recognise. */
const OUTLOOK_SEPARATOR = /^\s*-{5}\s*(?:Original Message|Ursprüngliche Nachricht)\s*-{5}\s*$/imu
/** The labelled lines of an Outlook header block, German and English. */
const LABELS: Record<'from' | 'sent' | 'to' | 'cc' | 'subject', RegExp> = {
  from: /^\s*\**(?:From|Von)\**\s*:\s*(.+)$/imu,
  sent: /^\s*\**(?:Sent|Gesendet|Date|Datum)\**\s*:\s*(.+)$/imu,
  to: /^\s*\**(?:To|An)\**\s*:\s*(.+)$/imu,
  cc: /^\s*\**(?:Cc|CC|Kopie|Kopie \(CC\))\**\s*:\s*(.+)$/imu,
  subject: /^\s*\**(?:Subject|Betreff)\**\s*:\s*(.+)$/imu,
}

/** Forwards of forwards followed at most; the innermost block is the mail's author. */
const MAX_NESTED_FORWARDS = 5

/**
 * The original of an inline forward. The library reads the body on its own
 * first; the classic Outlook block it lacks is read from its labelled lines;
 * only then is the outer subject („WG:“, „Fwd:“) given to it, which lets it
 * find a block that has no separator line (new Outlook, Outlook for Mac). A
 * forward of a forward is followed to the innermost block: who wrote it first.
 */
export function inlineOriginal(body: string, outerSubject: string | null): OriginalMessage | null {
  let found = outermostBlock(body, outerSubject)
  for (let depth = 0; found && depth < MAX_NESTED_FORWARDS; depth += 1) {
    const inner = outermostBlock(found.body, null)
    if (!inner) break
    found = inner
  }
  return found ? found.original : null
}

interface Block {
  original: OriginalMessage
  /** The text below the block's header lines, where a nested forward would be. */
  body: string
}

function outermostBlock(body: string, outerSubject: string | null): Block | null {
  if (body.trim() === '') return null
  return libraryBlock(body, undefined) ?? outlookBlock(body) ?? (outerSubject ? libraryBlock(body, outerSubject) : null)
}

function libraryBlock(body: string, subject: string | undefined): Block | null {
  const read = new EmailForwardParser().read(body, subject)
  if (!read.forwarded || !read.email.from?.address) return null
  const email = read.email
  // Read with the outer subject, the library reports that subject; the block's own „Betreff:“ line is the original's.
  const ownSubject = subject === undefined ? (email.subject ?? null) : (LABELS.subject.exec(body)?.[1]?.trim() ?? email.subject ?? null)
  return {
    original: inline({ from: cleanMailbox(email.from), to: listOf(email.to), cc: listOf(email.cc), subject: ownSubject, dateText: email.date ?? null }),
    body: email.body ?? '',
  }
}

function outlookBlock(body: string): Block | null {
  const separator = OUTLOOK_SEPARATOR.exec(body)
  if (!separator) return null
  const rest = body.slice(separator.index + separator[0].length)
  const [block = '', ...after] = rest.split(/\n\s*\n/u)
  const from = LABELS.from.exec(block)?.[1]
  if (!from) return null
  return {
    original: inline({
      from: parseMailbox(from),
      to: splitMailboxes(LABELS.to.exec(block)?.[1]),
      cc: splitMailboxes(LABELS.cc.exec(block)?.[1]),
      subject: LABELS.subject.exec(block)?.[1]?.trim() ?? null,
      dateText: LABELS.sent.exec(block)?.[1]?.trim() ?? null,
    }),
    body: after.join('\n\n'),
  }
}

function inline(parts: { from: OriginalMailbox | null; to: OriginalMailbox[]; cc: OriginalMailbox[]; subject: string | null; dateText: string | null }): OriginalMessage {
  return {
    source: 'inline',
    from: parts.from,
    to: parts.to,
    cc: parts.cc,
    subject: parts.subject,
    sentAt: parts.dateText ? parseForwardDate(parts.dateText) : null,
    sentAtText: parts.dateText,
    messageId: null,
  }
}

/**
 * A forward's date line as an instant. German first (the office's language),
 * then English. A line without a zone is a wall-clock time in {@link timeZone}.
 */
export function parseForwardDate(text: string, timeZone: string = OFFICE_TIME_ZONE): Date | null {
  const stated = /(?:[+-]\d{4}|\bGMT|\bUTC)\b/u.test(text) ? validDate(new Date(text)) : null
  if (stated) return stated
  const result = [chrono.de.parse(text)[0], chrono.parse(text)[0]].find((parsed) => parsed?.start.isCertain('day'))
  if (!result) return null
  const start = result.start
  if (start.isCertain('timezoneOffset')) return validDate(start.date())
  const wall = Date.UTC(start.get('year') ?? 0, (start.get('month') ?? 1) - 1, start.get('day') ?? 1, start.get('hour') ?? 0, start.get('minute') ?? 0, start.get('second') ?? 0)
  return validDate(new Date(wallTimeToInstant(wall, timeZone)))
}

/** The instant at which `timeZone`'s clocks read `wallUtcMs` (a wall time encoded as if UTC). Two passes settle DST. */
export function wallTimeToInstant(wallUtcMs: number, timeZone: string): number {
  let instant = wallUtcMs - offsetMs(wallUtcMs, timeZone)
  instant = wallUtcMs - offsetMs(instant, timeZone)
  return instant
}

function offsetMs(instant: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instant))
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return (match[1] === '-' ? -minutes : minutes) * 60_000
}

function validDate(date: Date): Date | null {
  return Number.isNaN(date.getTime()) ? null : date
}

function mailboxOf(address: Address): OriginalMailbox | null {
  if ('group' in address && address.group) return null
  return { name: address.name?.trim() || null, address: address.address?.toLowerCase() || null }
}

function mailboxesOf(address: Address): OriginalMailbox[] {
  if ('group' in address && address.group) return address.group.flatMap(mailboxesOf)
  const mailbox = mailboxOf(address)
  return mailbox ? [mailbox] : []
}

function cleanMailbox(mailbox: EmailForwardMailbox | null | undefined): OriginalMailbox | null {
  if (!mailbox) return null
  const address = mailbox.address?.trim().toLowerCase() || null
  const name = mailbox.name?.trim().replace(/^["']|["']$/g, '') || null
  return address || name ? { name, address } : null
}

function listOf(value: EmailForwardMailbox | EmailForwardMailbox[] | null | undefined): OriginalMailbox[] {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list.map(cleanMailbox).filter((mailbox): mailbox is OriginalMailbox => mailbox !== null)
}

/** `Name <a@b>`, `'Name' <a@b>`, `Name [mailto:a@b]`, `a@b`, or a bare name. */
export function parseMailbox(value: string): OriginalMailbox | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const named = /^["']?([^"'<[]*?)["']?\s*(?:<|\[mailto:)\s*([^<>\s[\]]+@[^<>\s[\]]+)\s*(?:>|\])$/u.exec(trimmed)
  if (named) return { name: named[1].trim() || null, address: named[2].toLowerCase() }
  if (/^[^\s@<>]+@[^\s@<>]+$/u.test(trimmed)) return { name: null, address: trimmed.toLowerCase() }
  return { name: trimmed.replace(/^["']|["']$/g, ''), address: null }
}

/** A `;`-separated recipient line (Outlook writes `Last, First` names, so a comma does not split). */
function splitMailboxes(value: string | undefined): OriginalMailbox[] {
  if (!value) return []
  return value
    .split(';')
    .map(parseMailbox)
    .filter((mailbox): mailbox is OriginalMailbox => mailbox !== null)
}

/** Text of an HTML body for the forward parser: line breaks kept, tags and entities gone. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/giu, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&amp;/giu, '&')
}
