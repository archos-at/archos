/**
 * The receive job's step for a forward (migration 0198): who wrote the mail a
 * colleague forwarded, recorded beside who forwarded it.
 *
 * `originalMessage` (`./original-message`) reads the original out of the raw
 * message: an attached one, or an inline forward's header block. What it
 * finds goes on the mail row while it is still `received`, before the job
 * holds it, so the filing step and the reviewer read it from the row:
 *
 * - **Attribution.** The original's From, Date and Subject name who wrote the
 *   message and when. Nothing here is verified, so it never changes the
 *   sender's trust; the `sender_*` columns stay the forwarder's (DKIM). Every
 *   project address in a name or subject is redacted (B8), as the receive job
 *   redacts the forward's own; an author address on this deployment's mail
 *   domain is no author and is left out.
 * - **Never a reason to drop.** An attached original's Message-ID is whatever
 *   the forward's sender wrote into the `.eml`, before anyone checked who that
 *   sender is: an outsider who knows the id of a mail they sent the architect
 *   can claim it. So the id never drops or merges a delivery. Every forward is
 *   held, its own text and attachments shown. Only at filing does the id count
 *   (`lib/mail-thread/append.ts`): an original the project's Verläufe already
 *   hold (`mail_thread_entries.author_message_id`) is not attributed a second
 *   section, and the forward is filed as its forwarder's own message.
 *
 * Idempotent: a retried job writes the same values again.
 */

import 'server-only'
import { normalizeMessageId } from '@/lib/mail-thread/mail-threading'
import { asciiLower, redactProjectAddresses } from './address'
import { originalMessage, type OriginalMessage } from './original-message'
import { findAddressToken } from './receive-repository'
import { recordOriginalFields, type OriginalFields } from './receive-original-repository'

/** What the step found: no forward, or a forward recorded. */
export type OriginalOutcome = 'none' | 'recorded'

/** Read and record the original of a `received` mail. */
export async function recordOriginal(
  mail: { id: string; addressId: string; receivedAt: Date },
  raw: Uint8Array,
  domain: string,
): Promise<OriginalOutcome> {
  const original = await originalMessage(raw, null)
  if (!original) return 'none'
  const token = await findAddressToken(mail.addressId)
  const fields = originalFieldsOf(original, {
    receivedAt: new Date(mail.receivedAt),
    domain,
    redact: (text) => redactProjectAddresses(text, domain, token),
  })
  if (!fields) return 'none'
  await recordOriginalFields(mail.id, fields)
  return 'recorded'
}

/**
 * The row's columns for an original, bounded as the CHECKs bound them; null
 * when it names nobody (no address on another domain, no name). Pure.
 */
export function originalFieldsOf(
  original: OriginalMessage,
  context: { receivedAt: Date; domain: string; redact: (text: string) => string },
): OriginalFields | null {
  const address = original.from?.address?.trim() ?? ''
  const ours = address !== '' && isOnDomain(address, context.domain)
  const authorAddress = address !== '' && !ours && address.length <= 320 ? address : null
  const name = original.from?.name ? oneLine(context.redact(original.from.name)).slice(0, 300) : ''
  const authorName = name !== '' && !name.includes('@') ? name : null
  if (!authorAddress && !authorName) return null
  const sentAt = original.sentAt && !Number.isNaN(original.sentAt.getTime()) ? original.sentAt : null
  const subject = original.subject ? oneLine(context.redact(original.subject)).slice(0, 998) : ''
  const messageId = original.source === 'attachment' ? normalizeMessageId(original.messageId) : null
  return {
    originalAuthorAddress: authorAddress,
    originalAuthorName: authorName,
    // A date after the forward arrived is a wrong clock, never the time it was written.
    originalSentAt: sentAt && sentAt > context.receivedAt ? context.receivedAt : sentAt,
    originalSubject: subject || null,
    originalMessageId: messageId && messageId.length <= 998 ? messageId : null,
    originalSource: original.source,
  }
}

function isOnDomain(address: string, domain: string): boolean {
  if (!domain) return false
  const host = asciiLower(address.slice(address.lastIndexOf('@') + 1))
  const ours = asciiLower(domain)
  return host === ours || host.endsWith(`.${ours}`)
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}
