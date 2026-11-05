/**
 * What a filed mail tells the knowledge layer beside the bytes (ADR-0137,
 * DECISION §6 "Ingest"): the two records `POST /v1/ingest` takes for it, in
 * the ingest contract's own snake_case (`agent_host.models.requests.MailThreadFacts`
 * and `MailOrigin`, both `extra="forbid"`).
 *
 * - `mail_thread`, on each Fassung of an E-Mail-Verlauf: the newest message's
 *   clamped send time (the document's date), how many messages this Fassung
 *   holds and the thread's locale. The chunks are then the `project_mail` lane.
 * - `mail_origin`, on each attachment filed with a message: when and from whom
 *   it came, as the heading says it, so `list_files` and `read_passage` print
 *   „kam mit der E-Mail vom … von …“, with „Domain nicht bestätigt“ unless a
 *   signature confirmed the domain. A forwarded message (migration 0198) is
 *   attributed to its author at the time they wrote it, whose domain nothing
 *   confirmed, and names its forwarder in `forwarded_by_*` and `forwarded_at`;
 *   `signer_domain` and `sender_trust` stay the forward's.
 *
 * No address and no text, ever: a display name that is an address is dropped
 * (the backend refuses one). Pure, so the filing job, the archive render and
 * the files eval's fixture (`files-eval-fixture.spec.ts`) compute one shape.
 * The zod schemas parse a record read back from a row (`./filing-choice` keeps
 * it for a quarantine release), so a stored value that no longer fits is no
 * value rather than a 422 at the backend.
 */

import { z } from 'zod'
import { SENDER_TRUSTS, type SenderTrust } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { clampSentAt, domainOf } from './mail-threading'
import {
  MAIL_THREAD_LOCALES,
  MAIL_THREAD_MAX_ENTRIES,
  type MailThreadLocale,
} from './mail-thread-vocabulary'

/** ISO 8601 in UTC, to the second, as the fixture and the backend's AwareDatetime read it. */
const isoSeconds = (at: Date): string => at.toISOString().replace(/\.\d{3}Z$/, 'Z')

const awareDateTime = z.string().datetime({ offset: true })
const domain = z.string().trim().min(1).max(253)
const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('@'), 'a display name, never an address')

/** `mail_thread` (`MailThreadFacts`). */
export const mailThreadIngestFactsSchema = z
  .object({
    latest_sent_at: awareDateTime,
    message_count: z.number().int().min(1).max(MAIL_THREAD_MAX_ENTRIES),
    locale: z.enum(MAIL_THREAD_LOCALES),
  })
  .strict()
export type MailThreadIngestFacts = z.infer<typeof mailThreadIngestFactsSchema>

/** `mail_origin` (`MailOrigin`). */
export const mailOriginIngestFactsSchema = z
  .object({
    sent_at: awareDateTime,
    received_at: awareDateTime.optional(),
    from_name: name.optional(),
    from_domain: domain.optional(),
    signer_domain: domain.optional(),
    sender_trust: z.enum(SENDER_TRUSTS),
    forwarded_by_name: name.optional(),
    forwarded_by_domain: domain.optional(),
    forwarded_at: awareDateTime.optional(),
    thread_document_id: z.string().uuid().optional(),
    locale: z.enum(MAIL_THREAD_LOCALES),
  })
  .strict()
export type MailOriginIngestFacts = z.infer<typeof mailOriginIngestFactsSchema>

/** What the two records are computed from: an entry's (or a held mail's) sender and times. */
export interface MailIngestMessage {
  sentAt: Date
  receivedAt: Date
  senderName: string | null
  senderDomain: string | null
  signerDomain: string | null
  senderTrust: SenderTrust
  /** Who wrote a forwarded message (migration 0198); the sender is then its forwarder. */
  author?: { name: string | null; address: string | null; sentAt: Date | null } | null
}

/** `mail_thread` for a Fassung holding these messages. Throws on none: a Fassung always holds one. */
export function mailThreadIngestFacts(
  messages: readonly MailIngestMessage[],
  locale: MailThreadLocale
): MailThreadIngestFacts {
  if (messages.length === 0) throw new Error('a mail thread Fassung holds at least one message')
  const latest = Math.max(
    ...messages.map((message) => clampSentAt(message.sentAt, message.receivedAt).sentAt.getTime())
  )
  return { latest_sent_at: isoSeconds(new Date(latest)), message_count: messages.length, locale }
}

/** A display name the backend takes: one line, at most 200 characters, never an address. */
function displayName(name: string | null): string | undefined {
  const clean = name?.replace(/\s+/g, ' ').trim().slice(0, 200).trim()
  return clean && !clean.includes('@') ? clean : undefined
}

/** A domain as stored, lower-case and without a trailing dot, or nothing. */
function cleanDomain(value: string | null): string | undefined {
  const clean = value?.trim().toLowerCase().replace(/\.$/, '').slice(0, 253)
  return clean || undefined
}

/**
 * `mail_origin` for an attachment that came with `message`. The send time is
 * clamped as the heading clamps it; `threadDocumentId` is the Verlauf it was
 * filed into, when there is one yet. A forwarded message names its author and
 * the time they wrote it (never after it arrived), as its heading does, and
 * its forwarder beside them.
 */
export function mailOriginIngestFacts(
  message: MailIngestMessage,
  options: { threadDocumentId: string | null; locale: MailThreadLocale }
): MailOriginIngestFacts {
  const sentAt = clampSentAt(message.sentAt, message.receivedAt).sentAt
  const author = message.author && (message.author.name || message.author.address) ? message.author : null
  const fromName = displayName(author ? author.name : message.senderName)
  const fromDomain = cleanDomain(author ? domainOf(author.address) : message.senderDomain)
  const signerDomain = cleanDomain(message.signerDomain)
  const written = author?.sentAt && author.sentAt <= message.receivedAt ? author.sentAt : sentAt
  const forwardedByName = author ? displayName(message.senderName) : undefined
  const forwardedByDomain = author ? cleanDomain(message.senderDomain) : undefined
  return {
    sent_at: isoSeconds(written),
    received_at: isoSeconds(message.receivedAt),
    ...(fromName ? { from_name: fromName } : {}),
    ...(fromDomain ? { from_domain: fromDomain } : {}),
    ...(signerDomain ? { signer_domain: signerDomain } : {}),
    sender_trust: message.senderTrust,
    ...(forwardedByName ? { forwarded_by_name: forwardedByName } : {}),
    ...(forwardedByDomain ? { forwarded_by_domain: forwardedByDomain } : {}),
    ...(author ? { forwarded_at: isoSeconds(sentAt) } : {}),
    ...(options.threadDocumentId ? { thread_document_id: options.threadDocumentId } : {}),
    locale: options.locale,
  }
}
