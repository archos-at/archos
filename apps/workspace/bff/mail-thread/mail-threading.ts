import { VERIFIED_SENDER_TRUSTS, type SenderTrust } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { type ThreadMatchHeader, type ThreadMatchStrength } from './mail-thread-vocabulary'

export { SENDER_TRUSTS, VERIFIED_SENDER_TRUSTS, type SenderTrust } from '@/lib/inbound-mail/inbound-mail-vocabulary'

export {
  THREAD_MATCH_HEADERS,
  THREAD_MATCH_STRENGTHS,
  type ThreadMatchHeader,
  type ThreadMatchStrength,
} from './mail-thread-vocabulary'

export const PRESELECTABLE_STRENGTHS: readonly ThreadMatchStrength[] = ['reference', 'thread_index']

export const SUBJECT_MATCH_WINDOW_DAYS = 60

export const MAX_SHOWN_THREAD_CANDIDATES = 3

const MAX_MESSAGE_ID = 998
const MAX_IN_REPLY_TO = 5
const MAX_REFERENCES = 50
const MAX_BASE_SUBJECT = 500
const DAY_MS = 86_400_000

export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null
  let id = raw.trim()
  if (id.startsWith('<') && id.endsWith('>')) id = id.slice(1, -1).trim()
  if (id.length < 3 || id.length > MAX_MESSAGE_ID) return null
  if (/[\s<>\p{Cc}]/u.test(id)) return null
  const at = id.lastIndexOf('@')
  return at > 0 ? `${id.slice(0, at)}@${id.slice(at + 1).toLowerCase()}` : id
}

export function parseMessageIdList(field: string | null | undefined): string[] {
  if (!field) return []
  const bracketed = [...field.matchAll(/<([^<>\s]+)>/g)].map((match) => match[1])
  const tokens = bracketed.length > 0 ? bracketed : /^\s*[^<>\s]+\s*$/.test(field) ? [field] : []
  const ids: string[] = []
  for (const token of tokens) {
    const id = normalizeMessageId(token)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export function parseInReplyTo(field: string | null | undefined): string[] {
  return parseMessageIdList(field).slice(0, MAX_IN_REPLY_TO)
}

export function parseReferences(field: string | null | undefined): string[] {
  const ids = parseMessageIdList(field)
  return ids.length <= MAX_REFERENCES ? ids : [ids[0], ...ids.slice(-(MAX_REFERENCES - 1))]
}

const LEADER =
  /^(?:re|aw|antw|antwort|wg|fw|fwd|wtr|tr|sv|vs|rif|r|rv|enc|odp|pd|doorst|vl|ynt)(?:\[\d+\]|\(\d+\))?\s*[:：]\s*/iu
const GATEWAY = /^(?:\[\s*(?:extern|external|ext|extern\s*e-mail|caution)\s*\]|(?:extern|external|caution)\s*[:\-–])\s*/iu
const TRAILER = /\s*\((?:fwd|fw)\)\s*$/iu
const BLOB = /^\[[^[\]]*\]\s*/u
const FORWARD_WRAPPER = /^\[(?:fwd|fw|wg)\s*:\s*(.*)\]$/iu

export function baseSubject(subject: string | null | undefined): string {
  let current = (subject ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim()
  for (let previous = ''; previous !== current; ) {
    previous = current
    current = current.replace(TRAILER, '')
    const withoutBlob = current.replace(BLOB, '')
    if (withoutBlob) current = withoutBlob
    current = current.replace(LEADER, '').replace(GATEWAY, '')
    const wrapped = FORWARD_WRAPPER.exec(current)
    if (wrapped) current = wrapped[1]
    current = current.trim()
  }
  return caseFold(current).slice(0, MAX_BASE_SUBJECT)
}

function caseFold(value: string): string {
  return value.toLowerCase().replace(/ß/gu, 'ss')
}

export function threadIndexGuid(base64: string | null | undefined): string | null {
  if (!base64) return null
  const compact = base64.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length > 4096) return null
  let binary: string
  try {
    binary = atob(compact)
  } catch {
    return null
  }
  return threadIndexGuidFromBytes(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

export function threadIndexGuidFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 22) return null
  const guid = bytes.subarray(6, 22)
  if (guid.every((byte) => byte === 0)) return null
  const hex = Array.from(guid, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface ThreadingMessage {
  messageId: string | null
  inReplyTo: readonly string[]
  references: readonly string[]
  threadIndexGuid: string | null
  baseSubject: string
  participants: readonly string[]
  sentAt: Date
}

export interface ThreadCandidate {
  threadId: string
  baseSubject: string
  threadIndexGuid: string | null
  receivedIds: readonly string[]
  referencedIds: readonly string[]
  participants: readonly string[]
  lastEntryAt: Date | null
}

export interface ThreadMatch {
  threadId: string
  strength: ThreadMatchStrength
  headers: ThreadMatchHeader[]
}

const STRENGTH_RANK: Readonly<Record<ThreadMatchStrength, number>> = {
  reference: 0,
  thread_index: 1,
  reference_subject_changed: 2,
  subject: 3,
}

export function matchThread(message: ThreadingMessage, candidates: readonly ThreadCandidate[]): ThreadMatch[] {
  const matches: Array<{ match: ThreadMatch; lastEntryAt: number }> = []
  for (const candidate of candidates) {
    const match = matchOne(message, candidate)
    if (match) matches.push({ match, lastEntryAt: candidate.lastEntryAt?.getTime() ?? 0 })
  }
  return matches
    .sort(
      (a, b) =>
        STRENGTH_RANK[a.match.strength] - STRENGTH_RANK[b.match.strength] ||
        b.lastEntryAt - a.lastEntryAt ||
        a.match.threadId.localeCompare(b.match.threadId)
    )
    .map(({ match }) => match)
}

function matchOne(message: ThreadingMessage, thread: ThreadCandidate): ThreadMatch | null {
  const sameSubject = message.baseSubject === thread.baseSubject
  const received = new Set(thread.receivedIds)
  const cites = (ids: readonly string[], within: ReadonlySet<string>) =>
    ids.some((id) => id !== message.messageId && within.has(id))

  const headers: ThreadMatchHeader[] = []
  if (cites(message.inReplyTo, received)) headers.push('in-reply-to')
  if (cites(message.references, received)) headers.push('references')
  if (headers.length > 0)
    return { threadId: thread.threadId, strength: sameSubject ? 'reference' : 'reference_subject_changed', headers }

  if (sameSubject && message.threadIndexGuid && message.threadIndexGuid === thread.threadIndexGuid)
    return { threadId: thread.threadId, strength: 'thread_index', headers: ['thread-index'] }

  if (!sameSubject || !message.baseSubject) return null
  const referenced = new Set(thread.referencedIds)
  const citesAncestor = cites(message.inReplyTo, referenced) || cites(message.references, referenced)
  if (citesAncestor || (sharesParticipant(message, thread) && activeWithin(message, thread)))
    return { threadId: thread.threadId, strength: 'subject', headers: ['subject'] }
  return null
}

function sharesParticipant(message: ThreadingMessage, thread: ThreadCandidate): boolean {
  const known = new Set(thread.participants.map((address) => address.toLowerCase()))
  return message.participants.some((address) => known.has(address.toLowerCase()))
}

function activeWithin(message: ThreadingMessage, thread: ThreadCandidate): boolean {
  if (!thread.lastEntryAt) return false
  return Math.abs(message.sentAt.getTime() - thread.lastEntryAt.getTime()) <= SUBJECT_MATCH_WINDOW_DAYS * DAY_MS
}

export interface SenderEvidence {
  senderTrust: SenderTrust
  senderFlags: readonly string[]
  signedHeaders: readonly string[]
}

export const PRESELECTION_BLOCKS = [
  'weak_match',
  'sender_not_verified',
  'header_not_signed',
  'not_addressed_to_project',
  'stale_date',
  'date_out_of_range',
  'claims_member_name',
] as const
export type PreselectionBlock = (typeof PRESELECTION_BLOCKS)[number]

export interface ThreadPreselection {
  preselected: boolean
  blocks: PreselectionBlock[]
}

export function signedHeaderSet(sender: Pick<SenderEvidence, 'signedHeaders'>): ReadonlySet<string> {
  return new Set(sender.signedHeaders.map((header) => header.trim().toLowerCase()))
}

export function isOwnBccCopy(sender: Pick<SenderEvidence, 'senderTrust' | 'senderFlags'>): boolean {
  return sender.senderTrust === 'member_verified' && sender.senderFlags.includes('bcc_own')
}

export function senderPreselectionBlocks(
  sender: Pick<SenderEvidence, 'senderTrust' | 'senderFlags'>
): PreselectionBlock[] {
  const blocks: PreselectionBlock[] = []
  if (!VERIFIED_SENDER_TRUSTS.includes(sender.senderTrust)) blocks.push('sender_not_verified')
  if (sender.senderFlags.includes('not_addressed_to_project') && !isOwnBccCopy(sender))
    blocks.push('not_addressed_to_project')
  if (sender.senderFlags.includes('stale_date')) blocks.push('stale_date')
  if (sender.senderFlags.includes('date_out_of_range')) blocks.push('date_out_of_range')
  if (sender.senderFlags.includes('claims_member_name')) blocks.push('claims_member_name')
  return blocks
}

export function threadPreselection(match: ThreadMatch, sender: SenderEvidence): ThreadPreselection {
  const blocks = senderPreselectionBlocks(sender)
  if (!PRESELECTABLE_STRENGTHS.includes(match.strength)) blocks.unshift('weak_match')
  if (sender.senderTrust === 'external_verified' && !restsOnSignedHeader(match, sender)) blocks.push('header_not_signed')
  return { preselected: blocks.length === 0, blocks }
}

export function restsOnSignedHeader(match: ThreadMatch, sender: Pick<SenderEvidence, 'signedHeaders'>): boolean {
  const signed = signedHeaderSet(sender)
  return match.headers.some((header) => signed.has(header))
}

export function appendNeedsAcknowledgement(sender: SenderEvidence, match: ThreadMatch | undefined): boolean {
  if (senderPreselectionBlocks(sender).length > 0) return true
  if (!match || match.strength === 'subject') return false
  return sender.senderTrust === 'external_verified' && !restsOnSignedHeader(match, sender)
}

export const SENT_AT_WINDOW_DAYS = 30

export const SENT_AT_CLOCK_SKEW_MINUTES = 15

const MINUTE_MS = 60_000

export function clampSentAt(sentAt: Date | null, receivedAt: Date): { sentAt: Date; outOfRange: boolean } {
  const time = sentAt?.getTime()
  if (time === undefined || Number.isNaN(time)) return { sentAt: receivedAt, outOfRange: true }
  const received = receivedAt.getTime()
  if (time < received - SENT_AT_WINDOW_DAYS * DAY_MS) return { sentAt: receivedAt, outOfRange: true }
  if (time > received) {
    return { sentAt: receivedAt, outOfRange: time > received + SENT_AT_CLOCK_SKEW_MINUTES * MINUTE_MS }
  }
  return { sentAt: new Date(time), outOfRange: false }
}

export function domainOf(address: string | null | undefined): string | null {
  if (!address) return null
  const at = address.lastIndexOf('@')
  if (at < 0) return null
  const domain = address
    .slice(at + 1)
    .trim()
    .replace(/>$/, '')
    .replace(/\.$/, '')
  if (!domain) return null
  return asciiDomain(domain) ?? domain.toLowerCase()
}

function asciiDomain(domain: string): string | null {
  if (/^\[|^[\d.]+$|[/?#\\@:%]/.test(domain)) return null
  try {
    return new URL(`http://${domain}/`).hostname || null
  } catch {
    return null
  }
}
