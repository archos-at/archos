import 'server-only'
import { normalizeMessageId } from '@/lib/mail-thread/mail-threading'
import { asciiLower, redactProjectAddresses } from './address'
import { originalMessage, type OriginalMessage } from './original-message'
import { findAddressToken } from './receive-repository'
import { recordOriginalFields, type OriginalFields } from './receive-original-repository'

export type OriginalOutcome = 'none' | 'recorded'

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
