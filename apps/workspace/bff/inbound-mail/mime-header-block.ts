/**
 * The raw header block of a message, read over its bytes rather than taken
 * from a parser (ADR-0137): its fields as sent, and the key that makes two
 * deliveries of one mail the same mail. Part of reading a message (`./mime.ts`).
 */

import { createHash } from 'node:crypto'
import { asciiLower } from './address'

/** The header block is read this far for {@link rawHeaderFields}; postal-mime's own header cap. */
export const MAX_HEADER_BLOCK_BYTES = 2 * 1024 * 1024

/** One header field, its name lowercased, its value unfolded and otherwise as sent. */
export interface HeaderField {
  name: string
  value: string
}

/** The byte offset where the body starts (after the first empty line), or -1 when there is none within `limit`. */
function bodyOffset(bytes: Buffer, limit: number): number {
  const window = bytes.subarray(0, Math.min(bytes.length, limit))
  const lf = window.indexOf('\n\n')
  const crlf = window.indexOf('\n\r\n')
  const ends = [lf === -1 ? -1 : lf + 2, crlf === -1 ? -1 : crlf + 3].filter((index) => index !== -1)
  return ends.length > 0 ? Math.min(...ends) : -1
}

export function asBuffer(raw: Uint8Array): Buffer {
  return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
}

/**
 * The header fields of the raw message, unfolded, in order, duplicates kept.
 * The block ends at the first empty line, as it does for mailauth's and
 * postal-mime's parsers. `null` when a line in it is neither a field nor a
 * continuation, or when no empty line ends it within
 * {@link MAX_HEADER_BLOCK_BYTES} (a message that is all header, or one
 * 8 MiB line).
 *
 * Read over the raw bytes rather than taken from either parser, because the
 * point of reading it is to catch where they would disagree: a DKIM verifier
 * signs the LAST instance of a field and a MIME parser reads the FIRST, and an
 * unsigned duplicate above a signature is how a signed mail gets a new
 * Subject, recipient or boundary. Linear in the block.
 */
export function rawHeaderFields(raw: Uint8Array): HeaderField[] | null {
  const bytes = asBuffer(raw)
  const offset = bodyOffset(bytes, MAX_HEADER_BLOCK_BYTES)
  const end = offset === -1 ? (bytes.length <= MAX_HEADER_BLOCK_BYTES ? bytes.length : -1) : offset
  if (end === -1) return null
  const lines = bytes.toString('utf8', 0, end).split('\n')
  const fields: HeaderField[] = []
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') break
    if (line[0] === ' ' || line[0] === '\t') {
      const last = fields.at(-1)
      if (!last) return null
      last.value += line
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) return null
    fields.push({ name: asciiLower(line.slice(0, colon).trim()), value: line.slice(colon + 1) })
  }
  return fields
}

/** The value of the first field named `name` (lowercase), unfolded and trimmed. */
export function headerValue(fields: readonly HeaderField[], name: string): string | null {
  return fields.find((field) => field.name === name)?.value.trim() ?? null
}

/**
 * What makes two deliveries of one mail the same mail (`delivery_key`): the
 * header fields an author writes (From, To, Cc, Subject, Date, Message-ID, as
 * sent), the signature value (`b=`) of every DKIM-Signature, whitespace
 * removed, and the body bytes, hashed. Every relay on the way prepends its own
 * Received, ARC and Authentication-Results fields, so a retry by the sending
 * server after a lost answer has other raw bytes and still this key.
 *
 * The signatures are in it because the copy held is the copy judged: a copy
 * whose signature a list or forwarder stripped or broke, arriving first, must
 * not make the signed copy a `duplicate` that is erased while the mail is
 * held as unverified. Two copies that differ there are both held. A header
 * block that cannot be read (`rawHeaderFields` is null) says nothing about
 * which mail it is, so it is never a duplicate: its key is this delivery's own
 * (`mailId`), and the unique index can never match it to another.
 */
export function deliveryKey(raw: Uint8Array, mailId: string): string {
  const fields = rawHeaderFields(raw)
  if (fields === null) return createHash('sha256').update(`unread-header-block:${mailId}`).digest('hex')
  const bytes = asBuffer(raw)
  const offset = bodyOffset(bytes, bytes.length)
  const hash = createHash('sha256')
  for (const name of ['from', 'to', 'cc', 'subject', 'date', 'message-id']) {
    for (const field of fields) if (field.name === name) hash.update(`${name}:${field.value.trim()}\n`)
  }
  for (const field of fields) {
    if (field.name === 'dkim-signature') hash.update(`dkim-b:${dkimSignatureValue(field.value)}\n`)
  }
  hash.update('\n')
  hash.update(offset === -1 ? bytes : bytes.subarray(offset))
  return hash.digest('hex')
}

/** The `b=` tag of a DKIM-Signature, whitespace removed (RFC 6376 §3.5 lets a relay refold it); empty when absent. */
function dkimSignatureValue(value: string): string {
  for (const tag of value.split(';')) {
    const equals = tag.indexOf('=')
    if (equals !== -1 && tag.slice(0, equals).trim() === 'b') return tag.slice(equals + 1).replace(/\s+/g, '')
  }
  return ''
}
