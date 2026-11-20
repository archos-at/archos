import 'server-only'
import { BadRequestError } from '@/lib/api/errors'
import type { InboxItem } from '@/lib/db/schema/inbox'
import type { InboxCursor } from './repository'

export function encodeInboxCursor(cursor: InboxCursor): string {
  return Buffer.from(`${cursor.micros}|${cursor.id}`, 'utf8').toString('base64url')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function decodeInboxCursor(cursor: string): InboxCursor {
  const [micros, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  if (rest.length > 0 || !id || !UUID.test(id) || !micros || !/^\d{1,19}$/.test(micros)) {
    throw new BadRequestError('Invalid inbox cursor')
  }
  return { micros, id }
}

export function microsOf(row: InboxItem & { listedAtMicros?: string }): bigint {
  return row.listedAtMicros ? BigInt(row.listedAtMicros) : BigInt(row.updatedAt.getTime()) * BigInt(1000)
}

export function newestFirst(a: InboxItem, b: InboxItem): number {
  const ta = microsOf(a)
  const tb = microsOf(b)
  if (ta !== tb) return tb > ta ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}
