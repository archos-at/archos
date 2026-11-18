import { z } from 'zod'
import { SENDER_TRUSTS, type SenderTrust } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { clampSentAt, domainOf } from './mail-threading'
import {
  MAIL_THREAD_LOCALES,
  MAIL_THREAD_MAX_ENTRIES,
  type MailThreadLocale,
} from './mail-thread-vocabulary'

const isoSeconds = (at: Date): string => at.toISOString().replace(/\.\d{3}Z$/, 'Z')

const awareDateTime = z.string().datetime({ offset: true })
const domain = z.string().trim().min(1).max(253)
const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.includes('@'), 'a display name, never an address')

export const mailThreadIngestFactsSchema = z
  .object({
    latest_sent_at: awareDateTime,
    message_count: z.number().int().min(1).max(MAIL_THREAD_MAX_ENTRIES),
    locale: z.enum(MAIL_THREAD_LOCALES),
  })
  .strict()
export type MailThreadIngestFacts = z.infer<typeof mailThreadIngestFactsSchema>

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

export interface MailIngestMessage {
  sentAt: Date
  receivedAt: Date
  senderName: string | null
  senderDomain: string | null
  signerDomain: string | null
  senderTrust: SenderTrust
  author?: { name: string | null; address: string | null; sentAt: Date | null } | null
}

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

function displayName(name: string | null): string | undefined {
  const clean = name?.replace(/\s+/g, ' ').trim().slice(0, 200).trim()
  return clean && !clean.includes('@') ? clean : undefined
}

function cleanDomain(value: string | null): string | undefined {
  const clean = value?.trim().toLowerCase().replace(/\.$/, '').slice(0, 253)
  return clean || undefined
}

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
