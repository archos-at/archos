import type { InboundMailTextView } from '@/lib/inbound-mail/inbound-mail-wire'
import { isForwardSubject } from './subject'

export interface ForwardedOrigin {
  name: string | null
  address: string | null
}

const FROM_LINE = /^\s*\**\s*(?:von|from|de|da|van|od|fra|från)\s*\**\s*[:：]\s*\**\s*(.+?)\s*$/imu
const NAMED = /^"?([^"<[]*?)"?\s*(?:<|\[mailto:)\s*([^<>\s[\]]+@[^<>\s[\]]+)\s*(?:>|\])\s*$/u
const BARE = /^<?([^<>\s@]+@[^<>\s@]+)>?$/u

export function forwardedOrigin(subject: string | null, text: Pick<InboundMailTextView, 'quoted'> | null): ForwardedOrigin | null {
  if (!text || !isForwardSubject(subject)) return null
  const first = text.quoted[0]
  if (!first) return null
  const match = FROM_LINE.exec(first.header) ?? FROM_LINE.exec(first.text.split('\n').slice(0, 8).join('\n'))
  if (!match) return null
  return parseAddressLine(match[1])
}

export function parseAddressLine(value: string): ForwardedOrigin | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const named = NAMED.exec(trimmed)
  if (named) return { name: named[1].trim() || null, address: named[2].toLowerCase() }
  const bare = BARE.exec(trimmed)
  if (bare) return { name: null, address: bare[1].toLowerCase() }
  return { name: trimmed, address: null }
}
