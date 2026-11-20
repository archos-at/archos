import type { Locale } from '@/i18n/config'
import { SCREENING_PLACEHOLDERS } from '@/lib/upload-screening/content-screen'
import { escapeInline, escapeMarkdown } from '@/lib/text/markdown-escape'
import { clampSentAt, VERIFIED_SENDER_TRUSTS, type SenderTrust } from './mail-threading'
import type {
  MailThreadAttachmentDisposition,
  MailThreadCalendarEvent,
  MailThreadEntrySource,
  MailThreadMaskedSpan,
  MailThreadParticipant,
  MailThreadQuote,
  MailThreadSectionAttachment,
} from './mail-thread-wire'
import { MAIL_THREAD_RENDER_COPY, type MailThreadRenderCopy } from './render-copy'

export const MAX_SECTION_TEXT_CHARS = 100_000
const MAX_NAME_CHARS = 80
const MAX_SUBJECT_CHARS = 300
const MAX_LISTED_RECIPIENTS = 10
const MIN_FOLD_CHARS = 20
const FOLD_RESIDUE_PER_ENTRY = 200

export interface MailThreadAuthor {
  name: string | null
  address: string | null
  sentAt: Date | null
}

export interface MailThreadHeadingFields {
  source: MailThreadEntrySource
  sentAt: Date
  receivedAt: Date
  senderName: string | null
  senderAddress: string | null
  senderDomain: string | null
  signerDomain: string | null
  senderTrust: SenderTrust
  author?: MailThreadAuthor | null
}

export interface MailThreadRenderEntry extends MailThreadHeadingFields {
  id: string
  heading: string
  filedAt: Date
  subject?: string | null
  inReplyToEntryId: string | null
  participants: readonly MailThreadParticipant[]
  ownText: string
  maskedSpans: readonly MailThreadMaskedSpan[] | null
  quoted: readonly MailThreadQuote[]
  calendar: readonly MailThreadCalendarEvent[]
  attachments: readonly MailThreadSectionAttachment[]
}

export interface MailThreadRenderInput {
  title: string
  locale: Locale
  continues: string | null
  entries: readonly MailThreadRenderEntry[]
}

export interface MailThreadRendition {
  markdown: string
  bytes: number
  sections: Array<{ entryId: string; heading: string }>
}

export class MailThreadRenderError extends Error {
  constructor(
    readonly code: 'heading_mismatch' | 'duplicate_heading',
    readonly entryId: string
  ) {
    super(`Mail thread entry ${entryId} cannot be rendered: ${code}`)
    this.name = 'MailThreadRenderError'
  }
}

export function mailThreadEntryHeading(
  fields: MailThreadHeadingFields,
  taken: Iterable<string>,
  locale: Locale
): string {
  const base = entryHeadingBase(fields, locale)
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n += 1) if (!used.has(`${base} (${n})`)) return `${base} (${n})`
}

export function entryHeadingBase(fields: MailThreadHeadingFields, locale: Locale): string {
  const copy = MAIL_THREAD_RENDER_COPY[locale]
  const at = clampSentAt(fields.sentAt, fields.receivedAt).sentAt
  const author = fields.author
  if (author && (author.name || author.address)) {
    const written = author.sentAt && author.sentAt <= fields.receivedAt ? author.sentAt : at
    const domain = cleanDomain(author.address ? author.address.slice(author.address.lastIndexOf('@') + 1) : null)
    const authority = [domain, copy.unverifiedDomain].filter(Boolean).join(', ')
    return `${copy.dateTime(written)} · ${displayName(author.name, author.address, copy)} (${authority})`
  }
  const who = displayName(fields.senderName, fields.senderAddress, copy)
  return `${copy.dateTime(at)} · ${who} (${headingAuthority(fields, copy)})`
}

function forwardedByLine(entry: MailThreadHeadingFields, copy: MailThreadRenderCopy): string {
  const who = displayName(entry.senderName, entry.senderAddress, copy)
  const at = clampSentAt(entry.sentAt, entry.receivedAt).sentAt
  return `${who} (${headingAuthority(entry, copy)}), ${copy.dateTime(at)}`
}

function headingAuthority(fields: MailThreadHeadingFields, copy: MailThreadRenderCopy): string {
  const fromDomain = cleanDomain(fields.senderDomain)
  if (fields.source === 'archive') return [fromDomain, copy.fromArchive].filter(Boolean).join(', ')
  const signer = cleanDomain(fields.signerDomain)
  if (VERIFIED_SENDER_TRUSTS.includes(fields.senderTrust) && signer) return signer
  return [fromDomain, copy.unverifiedDomain].filter(Boolean).join(', ')
}

export function headingMatchesEntry(entry: MailThreadRenderEntry, locale: Locale): boolean {
  const base = entryHeadingBase(entry, locale)
  if (entry.heading === base) return true
  if (!entry.heading.startsWith(`${base} (`)) return false
  return /^\d+\)$/.test(entry.heading.slice(base.length + 2))
}

export function renderMailThread(input: MailThreadRenderInput): MailThreadRendition {
  const copy = MAIL_THREAD_RENDER_COPY[input.locale]
  const headings = new Set<string>()
  for (const entry of input.entries) {
    if (!headingMatchesEntry(entry, input.locale)) throw new MailThreadRenderError('heading_mismatch', entry.id)
    if (headings.has(entry.heading)) throw new MailThreadRenderError('duplicate_heading', entry.id)
    headings.add(entry.heading)
  }

  const ordered = [...input.entries].sort(documentOrder)
  const filingRank = new Map([...input.entries].sort(filingOrder).map((entry, index) => [entry.id, index]))
  const byId = new Map(input.entries.map((entry) => [entry.id, entry]))
  const filedBefore = (entry: MailThreadRenderEntry) =>
    input.entries.filter((other) => (filingRank.get(other.id) ?? 0) < (filingRank.get(entry.id) ?? 0))

  const blocks = [preamble(input, ordered, copy)]
  for (const entry of ordered) {
    const answered = entry.inReplyToEntryId ? byId.get(entry.inReplyToEntryId) : undefined
    const earlier = filedBefore(entry)
    blocks.push(section(entry, answered && earlier.includes(answered) ? answered : undefined, earlier, input.title, copy))
  }
  const markdown = `${blocks.join('\n\n')}\n`
  return {
    markdown,
    bytes: new TextEncoder().encode(markdown).length,
    sections: ordered.map((entry) => ({ entryId: entry.id, heading: entry.heading })),
  }
}

function documentOrder(a: MailThreadRenderEntry, b: MailThreadRenderEntry): number {
  return (
    clampSentAt(a.sentAt, a.receivedAt).sentAt.getTime() - clampSentAt(b.sentAt, b.receivedAt).sentAt.getTime() ||
    a.receivedAt.getTime() - b.receivedAt.getTime() ||
    a.id.localeCompare(b.id)
  )
}

function filingOrder(a: MailThreadRenderEntry, b: MailThreadRenderEntry): number {
  return a.filedAt.getTime() - b.filedAt.getTime() || a.id.localeCompare(b.id)
}

function preamble(
  input: MailThreadRenderInput,
  ordered: readonly MailThreadRenderEntry[],
  copy: MailThreadRenderCopy
): string {
  const title = oneLine(input.title) || copy.unknownSender
  const lines = [`# ${escapeInline(title)}`]
  if (ordered.length > 0) {
    const first = clampSentAt(ordered[0].sentAt, ordered[0].receivedAt).sentAt
    const last = clampSentAt(ordered.at(-1)!.sentAt, ordered.at(-1)!.receivedAt).sentAt
    lines.push('', `*${escapeInline(copy.summary(ordered.length, first, last))}*`)
  }
  if (input.continues) lines.push('', `*${escapeInline(copy.continues(oneLine(input.continues)))}*`)
  return lines.join('\n')
}

function section(
  entry: MailThreadRenderEntry,
  answered: MailThreadRenderEntry | undefined,
  earlier: readonly MailThreadRenderEntry[],
  title: string,
  copy: MailThreadRenderCopy
): string {
  const heading = escapeInline(oneLine(entry.heading))
  const parts = [`## ${heading}`, `*${escapeInline(copy.received(entry.receivedAt))}*`]
  if (clampSentAt(entry.sentAt, entry.receivedAt).outOfRange) parts.push(`*${escapeInline(copy.dateOutOfRange)}*`)

  const facts = factLines(entry, answered, title, copy)
  if (facts.length > 0) parts.push(facts.join('\n'))
  parts.push(bodyText(masked(entry.ownText, entry.maskedSpans), copy))

  const quoteHeadings = new Set<string>()
  for (const quote of entry.quoted) {
    if (foldsInto(quote, earlier)) continue
    let label = copy.quoteIn(oneLine(entry.heading))
    for (let n = 2; quoteHeadings.has(label); n += 1) label = `${copy.quoteIn(oneLine(entry.heading))} (${n})`
    quoteHeadings.add(label)
    parts.push(`### ${escapeInline(label)}`, bodyText(quote.text, copy))
  }
  return parts.join('\n\n')
}

function factLines(
  entry: MailThreadRenderEntry,
  answered: MailThreadRenderEntry | undefined,
  title: string,
  copy: MailThreadRenderCopy
): string[] {
  const lines: string[] = []
  const fact = (label: string, value: string) => lines.push(`- **${escapeInline(label)}:** ${escapeInline(value)}`)
  const subject = ownSubject(entry.subject, title)
  if (subject) fact(copy.subject, subject)
  if (entry.author && (entry.author.name || entry.author.address)) fact(copy.forwardedBy, forwardedByLine(entry, copy))
  if (answered) fact(copy.replyTo, oneLine(answered.heading))
  for (const role of ['to', 'cc'] as const) {
    const names = entry.participants.filter((p) => p.role === role).map((p) => recipient(p, copy))
    if (names.length === 0) continue
    const listed = names.slice(0, MAX_LISTED_RECIPIENTS).join(', ')
    const rest = names.length - MAX_LISTED_RECIPIENTS
    fact(copy[role], rest > 0 ? `${listed} ${copy.more(rest)}` : listed)
  }
  for (const event of entry.calendar) fact(copy.meeting, meetingLine(event, copy))
  const attachments = attachmentLine(entry.attachments, copy)
  if (attachments) fact(copy.attachments, attachments)
  return lines
}

// A mail's subject where it says more than the Verlauf's name: an Outlook reader finds a mail by its subject, and a
// reply that changed it („… – Nachreichung Statik“) left no trace in the record, the search or the agent's passages.
function ownSubject(subject: string | null | undefined, title: string): string | null {
  const own = subject ? oneLine(subject).slice(0, MAX_SUBJECT_CHARS) : ''
  if (!own) return null
  const same = (value: string) => value.normalize('NFC').toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()
  return same(own) === same(oneLine(title)) ? null : own
}

function recipient(participant: MailThreadParticipant, copy: MailThreadRenderCopy): string {
  const name = displayName(participant.name, participant.address, copy)
  const domain = cleanDomain(participant.address.slice(participant.address.lastIndexOf('@') + 1))
  return domain ? `${name} (${domain})` : name
}

function meetingLine(event: MailThreadCalendarEvent, copy: MailThreadRenderCopy): string {
  const parts: string[] = []
  if (event.summary) parts.push(oneLine(event.summary))
  if (event.start) {
    const start = new Date(event.start)
    const format = event.allDay ? copy.date : copy.dateTime
    let when = format(start)
    if (event.end && !event.allDay) {
      const end = new Date(event.end)
      const endText = copy.date(end) === copy.date(start) ? copy.dateTime(end).slice(-5) : copy.dateTime(end)
      when += ` ${copy.until} ${endText}`
    }
    parts.push(when)
  }
  if (event.location) parts.push(oneLine(event.location))
  const cancelled = event.method?.toUpperCase() === 'CANCEL' || event.status?.toUpperCase() === 'CANCELLED'
  const line = parts.join(', ') || copy.meeting
  return cancelled ? `${line} (${copy.cancelled})` : line
}

function attachmentLine(attachments: readonly MailThreadSectionAttachment[], copy: MailThreadRenderCopy): string {
  const named: string[] = []
  let unnamed = 0
  for (const attachment of attachments) {
    const name = attachment.name ? oneLine(attachment.name) : ''
    if (!name) {
      unnamed += 1
      continue
    }
    const folder = attachment.folderPath ? folderWords(attachment.folderPath) : ''
    named.push(folder ? `${name} (${copy.filedIn(folder)})` : name)
  }
  if (unnamed > 0) named.push(copy.unnamedAttachments(unnamed))
  return named.join('; ')
}

function folderWords(folderPath: string): string {
  return oneLine(folderPath).replace(/^\/+/, '').replace(/\/+$/, '')
}

export interface MailThreadAttachmentFiling {
  disposition: MailThreadAttachmentDisposition
  name: string | null
  folderPath: string | null
  visibleWithThread: boolean
  nameReleased: boolean
}

export function sectionAttachment(filing: MailThreadAttachmentFiling): MailThreadSectionAttachment {
  const name = filing.name ? oneLine(filing.name).slice(0, 500) : ''
  if (filing.disposition === 'not_filed' || !name || !filing.visibleWithThread || filing.nameReleased) {
    return { name: null, folderPath: null }
  }
  const folderPath = filing.folderPath ? oneLine(filing.folderPath).slice(0, 1000) : ''
  return { name, folderPath: folderPath || null }
}

const LINE_TERMINATORS = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/g
const CONTROLS = /[\x00-\x08\x0e-\x1f\x7f-\x84\x86-\x9f]/g
const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g

function oneLine(value: string): string {
  return value.replace(LINE_TERMINATORS, ' ').replace(CONTROLS, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
}

function bodyText(raw: string, copy: MailThreadRenderCopy): string {
  let text = raw
    .replace(LINE_TERMINATORS, '\n')
    .replace(CONTROLS, '')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+$/gm, '')
  let cut = false
  if (text.length > MAX_SECTION_TEXT_CHARS) {
    text = text.slice(0, MAX_SECTION_TEXT_CHARS)
    cut = true
  }
  text = escapeMarkdown(text).replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return `*${escapeInline(copy.noText)}*`
  return cut ? `${text}\n\n*${escapeInline(copy.truncated)}*` : text
}

function masked(text: string, spans: readonly MailThreadMaskedSpan[] | null): string {
  if (!spans || spans.length === 0) return text
  const ordered = spans
    .filter((span) => span.start < text.length)
    .map((span) => ({ ...span, end: Math.min(span.end, text.length) }))
    .sort((a, b) => a.start - b.start || b.end - a.end)
  let out = ''
  let cursor = 0
  for (const span of ordered) {
    if (span.end <= cursor) continue
    if (span.start >= cursor) out += text.slice(cursor, span.start) + SCREENING_PLACEHOLDERS[span.kind]
    cursor = span.end
  }
  return out + text.slice(cursor)
}

function foldable(text: string): string {
  return text
    .normalize('NFC')
    .split(LINE_TERMINATORS)
    .map((line) => line.replace(/^\s*(?:>\s*)+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function foldsInto(quote: MailThreadQuote, earlier: readonly MailThreadRenderEntry[]): boolean {
  let rest = foldable(quote.text)
  let reproduced = 0
  for (const entry of earlier) {
    const own = foldable(entry.ownText)
    if (own.length < MIN_FOLD_CHARS || !rest.includes(own)) continue
    rest = rest.replace(own, ' ')
    reproduced += 1
  }
  return reproduced > 0 && rest.replace(/\s+/g, ' ').trim().length <= FOLD_RESIDUE_PER_ENTRY * reproduced
}

const BRACKETS = /[()<>[\]{}]/g

function displayName(name: string | null, address: string | null, copy: MailThreadRenderCopy): string {
  const clean = (value: string) => oneLine(value.replace(BRACKETS, ' ')).slice(0, MAX_NAME_CHARS).trim()
  const own = name && !name.includes('@') ? clean(name) : ''
  if (own) return own
  const local = address && address.includes('@') ? clean(address.slice(0, address.lastIndexOf('@'))) : ''
  return local || copy.unknownSender
}

function cleanDomain(domain: string | null): string {
  if (!domain) return ''
  return domain
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/[^\p{L}\p{N}.-]/gu, '')
    .slice(0, 253)
}
