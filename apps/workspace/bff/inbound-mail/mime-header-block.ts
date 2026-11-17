import { createHash } from 'node:crypto'
import { asciiLower } from './address'

export const MAX_HEADER_BLOCK_BYTES = 2 * 1024 * 1024

export interface HeaderField {
  name: string
  value: string
}

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

export function headerValue(fields: readonly HeaderField[], name: string): string | null {
  return fields.find((field) => field.name === name)?.value.trim() ?? null
}

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

function dkimSignatureValue(value: string): string {
  for (const tag of value.split(';')) {
    const equals = tag.indexOf('=')
    if (equals !== -1 && tag.slice(0, equals).trim() === 'b') return tag.slice(equals + 1).replace(/\s+/g, '')
  }
  return ''
}
