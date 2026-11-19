import { addressParser } from 'postal-mime'
import { asciiLower } from './address'
import type { DroppedReason } from './contract'
import type { HeaderField } from './mime'

export type AutomaticSignal =
  | 'auto_generated'
  | 'precedence_bulk'
  | 'list_headers'
  | 'auto_response_suppress'
  | 'null_sender'

export type AutomaticMailVerdict =
  | { outcome: 'drop'; reason: DroppedReason }
  | { outcome: 'keep'; automatic: boolean; signals: AutomaticSignal[] }

export interface AutomaticMailInput {
  headers: readonly HeaderField[] | null
  envelopeFrom: string | null
  inboundDomain: string
}

const AUTO_REPLY_HEADERS = ['x-autoreply', 'x-autorespond', 'x-autoresponder', 'x-auto-reply', 'x-vacation']

// Local parts of the reporting agents (RFC 5321 §4.5.5, RFC 3464).
const REPORTING_LOCAL_PARTS = new Set(['mailer-daemon'])

const DELIVERY_REPORT_TYPES = new Set(['delivery-status', 'disposition-notification'])

function values(headers: readonly HeaderField[], name: string): string[] {
  return headers.filter((header) => header.name === name).map((header) => header.value.trim())
}

function bareAddress(value: string): string {
  const angle = /<([^<>]*)>/.exec(value)
  return asciiLower((angle ? angle[1] : value).trim())
}

function fromAddresses(headers: readonly HeaderField[]): string[] {
  return values(headers, 'from')
    .flatMap((value) => addressParser(value, { flatten: true }))
    .map((mailbox) => asciiLower((mailbox.address ?? '').trim()))
    .filter((address) => address !== '')
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at === -1 ? '' : address.slice(at + 1)
}

function isOurs(domain: string, inboundDomain: string): boolean {
  const ours = asciiLower(inboundDomain)
  return ours !== '' && (domain === ours || domain.endsWith(`.${ours}`))
}

function dropReason(headers: readonly HeaderField[], input: AutomaticMailInput): DroppedReason | null {
  const from = fromAddresses(headers)
  const envelope = bareAddress(input.envelopeFrom ?? '')
  const ours = (address: string) => isOurs(domainOf(address), input.inboundDomain)
  if ((from.length > 0 && from.every(ours)) || (envelope !== '' && ours(envelope))) return 'self_loop'
  const contentType = asciiLower(values(headers, 'content-type')[0] ?? '')
  const reportType = /^\s*multipart\/report\b.*?\breport-type\s*=\s*"?([a-z-]+)/.exec(contentType)?.[1]
  if (reportType && DELIVERY_REPORT_TYPES.has(reportType)) return 'delivery_report'
  if (/^\s*message\/delivery-status\b/.test(contentType)) return 'delivery_report'
  if (from.some((address) => REPORTING_LOCAL_PARTS.has(address.slice(0, address.lastIndexOf('@'))))) {
    return 'delivery_report'
  }
  const autoSubmitted = asciiLower(values(headers, 'auto-submitted')[0] ?? '')
  if (/^auto-replied\b/.test(autoSubmitted)) return 'auto_reply'
  if (values(headers, 'precedence').some((value) => asciiLower(value) === 'auto_reply')) return 'auto_reply'
  if (AUTO_REPLY_HEADERS.some((name) => values(headers, name).some((value) => asciiLower(value) !== 'no'))) {
    return 'auto_reply'
  }
  return null
}

function automaticSignals(headers: readonly HeaderField[], input: AutomaticMailInput): AutomaticSignal[] {
  const signals: AutomaticSignal[] = []
  const autoSubmitted = asciiLower(values(headers, 'auto-submitted')[0] ?? '')
  if (autoSubmitted !== '' && !/^no\b/.test(autoSubmitted)) signals.push('auto_generated')
  const precedence = values(headers, 'precedence').map(asciiLower)
  if (precedence.some((value) => value === 'bulk' || value === 'junk' || value === 'list')) signals.push('precedence_bulk')
  if (['list-id', 'list-unsubscribe', 'list-post'].some((name) => values(headers, name).length > 0)) signals.push('list_headers')
  if (values(headers, 'x-auto-response-suppress').length > 0) signals.push('auto_response_suppress')
  if (input.envelopeFrom !== null && bareAddress(input.envelopeFrom) === '') signals.push('null_sender')
  return signals
}

export function classifyAutomaticMail(input: AutomaticMailInput): AutomaticMailVerdict {
  if (!input.headers) return { outcome: 'keep', automatic: false, signals: [] }
  const reason = dropReason(input.headers, input)
  if (reason) return { outcome: 'drop', reason }
  const signals = automaticSignals(input.headers, input)
  return { outcome: 'keep', automatic: signals.length > 0, signals }
}
