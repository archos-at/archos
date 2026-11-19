import { Resolver } from 'node:dns/promises'
import { authenticate, type AuthenticateResult, type DKIMResult, type DNSResolver } from 'mailauth'
import { addressParser } from 'postal-mime'
import { clampSentAt } from '@/lib/mail-thread/mail-threading'
import { asciiLower, parseInboundAddress } from './address'
import type { InboundSenderTrust, SenderFlag, SenderReason } from './contract'
import { INBOUND_MAIL_STALE_DATE_DAYS } from './inbound-mail-vocabulary'
import { headerValue, parseDateHeader, rawHeaderFields, type HeaderField } from './mime'

// RFC 5322 §3.6: fields a message carries at most once.
const SINGLETON_FIELDS = ['from', 'sender', 'to', 'cc', 'subject', 'date', 'message-id', 'in-reply-to', 'references', 'reply-to', 'content-type', 'mime-version'] as const

const REQUIRED_SIGNED_FIELDS = ['from', 'subject', 'message-id', 'date'] as const

export const MAX_DKIM_SIGNATURES = 8

// RSA keys shorter than this do not verify (RFC 8301 §3.2).
export const MIN_KEY_BITS = 1024

const DNS_TIMEOUT_MS = 3_000
const DNS_TRIES = 2

const VERIFY_DEADLINE_MS = 20_000

export const MAX_SIGNED_HEADERS = 64

export const MAX_EVIDENCE_LENGTH = 4096

export const BCC_WINDOW_MS = 24 * 60 * 60 * 1000

export const STALE_DATE_MS = INBOUND_MAIL_STALE_DATE_DAYS * 24 * 60 * 60 * 1000

const ASCII_ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/

export interface SenderAuthentication {
  fromAddress: string | null
  fromDomain: string | null
  verified: boolean
  reason: SenderReason
  signerDomain: string | null
  signedHeaders: string[]
  signedRecipientNamesProject: boolean
  authenticationResults: string
}

export interface AuthenticateSenderOptions {
  projectToken: string
  inboundDomain: string
  forwardedFrom?: readonly string[]
  envelopeFrom?: string | null
  resolver?: DNSResolver
  deadlineMs?: number
}

let defaultResolver: DNSResolver | null = null

function systemResolver(): DNSResolver {
  if (defaultResolver) return defaultResolver
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES })
  defaultResolver = async (name: string, rrtype: string) => {
    if (rrtype !== 'TXT') throw Object.assign(new Error(`unsupported ${rrtype}`), { code: 'ENOTIMP' })
    return resolver.resolveTxt(name)
  }
  return defaultResolver
}

function mailboxes(value: string): { name: string; address: string }[] {
  return addressParser(value, { flatten: true }).flatMap((entry) =>
    entry.address ? [{ name: entry.name, address: entry.address }] : []
  )
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1)
}

function duplicatedSingleton(fields: readonly HeaderField[]): string | null {
  const counts = new Map<string, number>()
  for (const { name } of fields) counts.set(name, (counts.get(name) ?? 0) + 1)
  return SINGLETON_FIELDS.find((name) => (counts.get(name) ?? 0) > 1) ?? null
}

export function signedFieldNames(signature: DKIMResult): string[] {
  const keys = signature.signingHeaders?.keys ?? ''
  const names = keys
    .split(':')
    .map((name) => asciiLower(name.trim()))
    .filter(Boolean)
  return [...new Set(names)].slice(0, MAX_SIGNED_HEADERS)
}

export interface ProjectRecipients {
  projectToken: string
  inboundDomain: string
  forwardedFrom: readonly string[]
}

export function namesProject(address: string, recipients: ProjectRecipients): boolean {
  const parsed = parseInboundAddress(address, recipients.inboundDomain)
  if (parsed.kind === 'token') return parsed.token === recipients.projectToken
  return parsed.kind === 'foreign' && recipients.forwardedFrom.includes(asciiLower(address.trim()))
}

function signsProjectRecipient(signature: DKIMResult, recipients: ProjectRecipients): boolean {
  for (const line of signature.signingHeaders?.headers ?? []) {
    const colon = line.indexOf(':')
    const name = asciiLower(line.slice(0, Math.max(0, colon)).trim())
    if (name !== 'to' && name !== 'cc') continue
    const value = line.slice(colon + 1).replace(/\r?\n/g, '')
    if (mailboxes(value).some((mailbox) => namesProject(mailbox.address, recipients))) return true
  }
  return false
}

function looselyAligned(signingDomain: string | undefined, fromDomain: string): boolean {
  const d = asciiLower(signingDomain ?? '')
  return d !== '' && (d === fromDomain || fromDomain.endsWith(`.${d}`) || d.endsWith(`.${fromDomain}`))
}

function judgeSignature(signature: DKIMResult, fromDomain: string): SenderReason {
  const result = signature.status.result
  const aligned = result === 'pass' ? Boolean(signature.status.aligned) : looselyAligned(signature.signingDomain, fromDomain)
  if (!aligned) return result === 'none' ? 'dkim_none' : 'dkim_unaligned'
  if (result === 'temperror' || result === 'temperr') return 'dkim_temperror'
  if (signature.signatureTimeValid === false) return 'dkim_expired'
  if (result === 'policy') return policyReason(signature)
  const bodyChanged = signature.bodyHash !== undefined && signature.bodyHashExpecting !== undefined && signature.bodyHash !== signature.bodyHashExpecting
  if (result === 'fail' || bodyChanged) return 'dkim_fail'
  if (result !== 'pass') return 'dkim_permerror'
  return hygieneOf(signature)
}

function policyReason(signature: DKIMResult): SenderReason {
  const rule = String(signature.status.policy?.['dkim-rules'] ?? '')
  if (rule === 'weak-algorithm' || asciiLower(signature.algo ?? '').endsWith('-sha1')) return 'dkim_weak_algorithm'
  if (rule === 'weak-key') return 'dkim_short_key'
  return 'dkim_policy'
}

function hygieneOf(signature: DKIMResult): SenderReason {
  if (signature.canonBodyLengthLimited || signature.status.underSized) return 'dkim_body_length'
  if (signature.status.testing) return 'dkim_testing'
  if (signature.signatureTimeValid === false) return 'dkim_expired'
  const signed = new Set(signedFieldNames(signature))
  if (REQUIRED_SIGNED_FIELDS.some((name) => !signed.has(name))) return 'dkim_unsigned_fields'
  if (asciiLower(signature.algo ?? '').endsWith('-sha1')) return 'dkim_weak_algorithm'
  if (signature.modulusLength !== undefined && signature.modulusLength < MIN_KEY_BITS) return 'dkim_short_key'
  return 'dkim_pass'
}

const SIGNATURE_RANK: readonly SenderReason[] = [
  'dkim_body_length',
  'dkim_testing',
  'dkim_expired',
  'dkim_unsigned_fields',
  'dkim_weak_algorithm',
  'dkim_short_key',
  'dkim_temperror',
  'dkim_fail',
  'dkim_policy',
  'dkim_permerror',
  'dkim_unaligned',
  'dkim_none',
]

function mostSpecific(reasons: readonly SenderReason[]): SenderReason {
  return SIGNATURE_RANK.find((reason) => reasons.includes(reason)) ?? 'dkim_none'
}

function cleanInfo(info: string): string {
  return info.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function evidenceLine(authservId: string, result: Pick<AuthenticateResult, 'dkim' | 'dmarc'>): string {
  const parts = [
    ...result.dkim.results.map((signature) => cleanInfo(signature.info)),
    ...(result.dmarc ? [cleanInfo(result.dmarc.info)] : []),
  ].filter((part) => part !== '' && !/(^|\s)spf=/i.test(part))
  const line = [cleanInfo(authservId) || 'unknown', ...parts].join('; ')
  return line.length <= MAX_EVIDENCE_LENGTH ? line : line.slice(0, MAX_EVIDENCE_LENGTH)
}

function unverified(reason: SenderReason, from: { address: string | null; domain: string | null }, evidence: string): SenderAuthentication {
  return {
    fromAddress: from.address,
    fromDomain: from.domain,
    verified: false,
    reason,
    signerDomain: null,
    signedHeaders: [],
    signedRecipientNamesProject: false,
    authenticationResults: evidence,
  }
}

function singleFrom(fields: readonly HeaderField[]): { address: string; domain: string } | SenderReason {
  const fromFields = fields.filter((field) => field.name === 'from')
  if (fromFields.length !== 1) return 'from_count'
  const parsed = mailboxes(fromFields[0].value)
  if (parsed.length !== 1) return 'from_count'
  const address = asciiLower(parsed[0].address.trim())
  if (!ASCII_ADDRESS.test(address)) return 'from_not_ascii'
  return { address, domain: domainOf(address) }
}

async function evaluate(raw: Uint8Array, options: AuthenticateSenderOptions): Promise<SenderAuthentication> {
  const authservId = asciiLower(options.inboundDomain)
  const fields = rawHeaderFields(raw)
  const none = { address: null, domain: null }
  if (!fields) return unverified('header_malformed', none, authservId)
  const from = singleFrom(fields)
  if (typeof from === 'string') return unverified(from, none, authservId)
  if (duplicatedSingleton(fields)) return unverified('header_duplicate', from, authservId)
  if (fields.filter((field) => field.name === 'dkim-signature').length > MAX_DKIM_SIGNATURES) {
    return unverified('dkim_too_many', from, authservId)
  }

  const result = await authenticate(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), {
    resolver: options.resolver ?? systemResolver(),
    mta: authservId,
    sender: options.envelopeFrom || undefined,
    minBitLength: MIN_KEY_BITS,
    rejectRsaSha1: true,
    disableArc: true,
    disableBimi: true,
  })
  const evidence = evidenceLine(authservId, result)
  if (result.dkim.headerFrom.length !== 1 || asciiLower(result.dkim.headerFrom[0]) !== from.address) {
    return unverified('from_count', from, evidence)
  }
  const judged = result.dkim.results.map((signature) => ({ signature, reason: judgeSignature(signature, from.domain) }))
  const admitting = judged.find((entry) => entry.reason === 'dkim_pass')?.signature
  if (!admitting) return unverified(mostSpecific(judged.map((entry) => entry.reason)), from, evidence)
  return {
    fromAddress: from.address,
    fromDomain: from.domain,
    verified: true,
    reason: 'dkim_pass',
    signerDomain: asciiLower(admitting.signingDomain ?? '') || null,
    signedHeaders: signedFieldNames(admitting),
    signedRecipientNamesProject: signsProjectRecipient(admitting, {
      projectToken: asciiLower(options.projectToken),
      inboundDomain: authservId,
      forwardedFrom: (options.forwardedFrom ?? []).map(asciiLower),
    }),
    authenticationResults: evidence,
  }
}

export async function authenticateSender(raw: Uint8Array, options: AuthenticateSenderOptions): Promise<SenderAuthentication> {
  const fields = rawHeaderFields(raw)
  const from = fields ? singleFrom(fields) : 'header_malformed'
  const fallback = typeof from === 'string' ? { address: null, domain: null } : from
  const authservId = asciiLower(options.inboundDomain)
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<SenderAuthentication>((resolve) => {
    timer = setTimeout(
      () => resolve(unverified('verifier_timeout', fallback, authservId)),
      options.deadlineMs ?? VERIFY_DEADLINE_MS
    )
  })
  try {
    return await Promise.race([evaluate(raw, options), deadline])
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown'
    console.warn(`[inbound-mail] sender authentication threw (${name}); labelling the mail unverified`)
    return unverified('verifier_error', fallback, authservId)
  } finally {
    clearTimeout(timer)
  }
}

export function isTransientReason(reason: SenderReason): boolean {
  return reason === 'dkim_temperror' || reason === 'verifier_timeout'
}

export interface JudgeSenderInput {
  memberUserId: string | null
  claimsMemberName?: boolean
  receivedAt: Date
  sentAtHeader: Date | null
}

export interface SenderVerdict {
  trust: InboundSenderTrust
  senderUserId: string | null
  flags: SenderFlag[]
  reason: SenderReason
  signerDomain: string | null
  signedHeaders: string[]
  authenticationResults: string
  sentAt: Date
  sentAtHeader: Date | null
}

export function judgeSender(authentication: SenderAuthentication, input: JudgeSenderInput): SenderVerdict {
  const member = input.memberUserId !== null && authentication.fromAddress !== null
  const verified = authentication.verified
  const trust: InboundSenderTrust = member
    ? verified
      ? 'member_verified'
      : 'member_unverified'
    : verified
      ? 'external_verified'
      : 'external_unverified'
  const clamped = clampSentAt(input.sentAtHeader, input.receivedAt)
  const flags: SenderFlag[] = []
  const age = input.sentAtHeader ? input.receivedAt.getTime() - input.sentAtHeader.getTime() : null
  if (verified && !authentication.signedRecipientNamesProject) {
    flags.push('not_addressed_to_project')
    if (trust === 'member_verified' && age !== null && Math.abs(age) <= BCC_WINDOW_MS) flags.push('bcc_own')
  }
  if (verified && age !== null && age > STALE_DATE_MS) flags.push('stale_date')
  if (clamped.outOfRange) flags.push('date_out_of_range')
  if (!member && input.claimsMemberName) flags.push('claims_member_name')
  if (verified && authentication.signerDomain !== authentication.fromDomain) flags.push('relaxed_alignment')
  return {
    trust,
    senderUserId: member ? input.memberUserId : null,
    flags,
    reason: authentication.reason,
    signerDomain: authentication.signerDomain,
    signedHeaders: authentication.signedHeaders,
    authenticationResults: authentication.authenticationResults,
    sentAt: clamped.sentAt,
    sentAtHeader: input.sentAtHeader,
  }
}

export function dateHeaderOf(raw: Uint8Array): Date | null {
  const fields = rawHeaderFields(raw)
  return fields ? parseDateHeader(headerValue(fields, 'date')) : null
}
