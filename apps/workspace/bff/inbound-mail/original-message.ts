import PostalMime, { type Address, type Attachment } from 'postal-mime'
import EmailForwardParser, { type EmailForwardMailbox } from 'email-forward-parser'
import * as chrono from 'chrono-node'
import { OFFICE_TIME_ZONE } from '@/lib/format'

export interface OriginalMailbox {
  name: string | null
  address: string | null
}

export interface OriginalMessage {
  source: 'attachment' | 'inline'
  from: OriginalMailbox | null
  to: OriginalMailbox[]
  cc: OriginalMailbox[]
  subject: string | null
  sentAt: Date | null
  sentAtText: string | null
  messageId: string | null
}

const MAX_ATTACHED_ORIGINALS = 3

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

const OUTLOOK_SEPARATOR = /^\s*-{5}\s*(?:Original Message|Ursprüngliche Nachricht)\s*-{5}\s*$/imu
const LABELS: Record<'from' | 'sent' | 'to' | 'cc' | 'subject', RegExp> = {
  from: /^\s*\**(?:From|Von)\**\s*:\s*(.+)$/imu,
  sent: /^\s*\**(?:Sent|Gesendet|Date|Datum)\**\s*:\s*(.+)$/imu,
  to: /^\s*\**(?:To|An)\**\s*:\s*(.+)$/imu,
  cc: /^\s*\**(?:Cc|CC|Kopie|Kopie \(CC\))\**\s*:\s*(.+)$/imu,
  subject: /^\s*\**(?:Subject|Betreff)\**\s*:\s*(.+)$/imu,
}

const MAX_NESTED_FORWARDS = 5

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

export function parseMailbox(value: string): OriginalMailbox | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const named = /^["']?([^"'<[]*?)["']?\s*(?:<|\[mailto:)\s*([^<>\s[\]]+@[^<>\s[\]]+)\s*(?:>|\])$/u.exec(trimmed)
  if (named) return { name: named[1].trim() || null, address: named[2].toLowerCase() }
  if (/^[^\s@<>]+@[^\s@<>]+$/u.test(trimmed)) return { name: null, address: trimmed.toLowerCase() }
  return { name: trimmed.replace(/^["']|["']$/g, ''), address: null }
}

function splitMailboxes(value: string | undefined): OriginalMailbox[] {
  if (!value) return []
  return value
    .split(';')
    .map(parseMailbox)
    .filter((mailbox): mailbox is OriginalMailbox => mailbox !== null)
}

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
