/**
 * The receive job's step for a forward (migration 0195): who wrote the mail a
 * colleague forwarded, recorded beside who forwarded it, and whether the
 * project already holds that original.
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
 * - **Two forwards are one mail.** An attached original's Message-ID is
 *   unique per project among open mails (`uniq_inbound_mails_open_original`),
 *   and a filed one stays on its entry (`mail_thread_entries.author_message_id`).
 *   Either way this mail is a `duplicate`: the job drops it silently, the way
 *   a redelivery is dropped, and audits the drop. Never a bounce. An inline
 *   forward has no Message-ID and is never a duplicate here.
 *
 * Idempotent: a retried job writes the same values again.
 */

import 'server-only'
import { isUniqueViolation } from '@/lib/db/errors'
import { normalizeMessageId } from '@/lib/mail-thread/mail-threading'
import { asciiLower, redactProjectAddresses } from './address'
import { originalMessage, type OriginalMessage } from './original-message'
import { findAddressToken } from './receive-repository'
import { isOriginalFiled, recordOriginalFields, type OriginalFields } from './receive-original-repository'

/** What the step found: no forward, a forward recorded, or a second forward of an original the project holds. */
export type OriginalOutcome = 'none' | 'recorded' | 'duplicate'

/** The index that makes two open forwards of one original one mail. */
export const OPEN_ORIGINAL_INDEX = 'uniq_inbound_mails_open_original'

/** Read, record and dedupe the original of a `received` mail. */
export async function recordOriginal(
  mail: { id: string; projectId: string; addressId: string; receivedAt: Date },
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
  if (fields.originalMessageId && (await isOriginalFiled(mail.projectId, fields.originalMessageId))) return 'duplicate'
  try {
    await recordOriginalFields(mail.id, fields)
  } catch (error) {
    if (isUniqueViolation(error, OPEN_ORIGINAL_INDEX)) return 'duplicate'
    throw error
  }
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
