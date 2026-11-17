import { randomBytes } from 'node:crypto'
import { fileSlug } from '@/lib/text/latinize'

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567' // pragma: allowlist secret

export const TOKEN_LENGTH = 12

export const TOKEN_PATTERN = /^[a-z2-7]{12}$/

export const SLUG_MAX_LENGTH = 30

export const REDACTED_TOKEN = '…'

export function mintToken(random: (size: number) => Uint8Array = randomBytes): string {
  return Array.from(random(TOKEN_LENGTH), (byte) => BASE32_ALPHABET[byte & 31]).join('')
}

export function projectSlug(projectName: string): string {
  return fileSlug(projectName, { maxLength: SLUG_MAX_LENGTH })
}

export function formatInboundAddress(
  slug: string,
  token: string,
  domain: string,
  localPart: string = inboundMailLocalPart()
): string {
  const detail = slug ? `${slug}.${token}` : token
  return `${asciiLower(localPart)}${SUBADDRESS_SEPARATOR}${detail}@${asciiLower(domain)}`
}

export type RecipientParse = { kind: 'token'; token: string } | { kind: 'malformed' } | { kind: 'foreign' }

export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

const SUBADDRESS_SEPARATOR = '+'

function unquote(local: string): string {
  return local.length >= 2 && local.startsWith('"') && local.endsWith('"') ? local.slice(1, -1) : local
}

function tokenOfLocalPart(local: string, localPart: string): string | null {
  const bare = asciiLower(unquote(local))
  const plus = bare.indexOf(SUBADDRESS_SEPARATOR)
  if (plus === -1 || bare.slice(0, plus) !== asciiLower(localPart)) return null
  const detail = bare.slice(plus + 1)
  const token = detail.slice(detail.lastIndexOf('.') + 1)
  return TOKEN_PATTERN.test(token) ? token : null
}

export function parseInboundAddress(
  recipient: string,
  domain: string,
  localPart: string = inboundMailLocalPart()
): RecipientParse {
  const trimmed = recipient.trim().replace(/^<|>$/g, '')
  const at = trimmed.lastIndexOf('@')
  const recipientDomain = at === -1 ? '' : asciiLower(trimmed.slice(at + 1))
  if (!domain || recipientDomain !== asciiLower(domain)) return { kind: 'foreign' }
  const token = tokenOfLocalPart(trimmed.slice(0, at), localPart)
  return token ? { kind: 'token', token } : { kind: 'malformed' }
}

export const DEFAULT_LOCAL_PART = 'project'

const LOCAL_PART_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

export function inboundMailLocalPart(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const raw = env.INBOUND_MAIL_LOCAL_PART?.trim()
  const localPart = raw ? asciiLower(raw) : DEFAULT_LOCAL_PART
  if (!LOCAL_PART_PATTERN.test(localPart)) {
    throw new Error(`INBOUND_MAIL_LOCAL_PART must be 1 to 32 of [a-z0-9-], without a hyphen at either end (got "${raw}")`)
  }
  return localPart
}

export function inboundMailDomain(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const domain = env.INBOUND_MAIL_DOMAIN?.trim()
  return domain ? asciiLower(domain) : null
}

const ADDRESS_CANDIDATE = /("[^"\s@]{1,64}"|[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})@([A-Za-z0-9.-]{1,255})/g

const HOST_CHARACTER = /[A-Za-z0-9-]/

export function redactProjectAddresses(
  text: string,
  domain: string,
  keep: string | null = null,
  localPart: string = inboundMailLocalPart()
): string {
  if (!domain || !text.includes('@')) return text
  const lowerDomain = asciiLower(domain)
  return text.replace(ADDRESS_CANDIDATE, (whole: string, local: string, host: string) => {
    const lowerHost = asciiLower(host)
    if (!lowerHost.startsWith(lowerDomain) || HOST_CHARACTER.test(lowerHost.charAt(lowerDomain.length))) return whole
    const token = tokenOfLocalPart(local, localPart)
    if (!token || token === keep) return whole
    const bare = unquote(local)
    const kept = bare.slice(0, bare.length - token.length)
    return `${kept}${REDACTED_TOKEN}@${lowerDomain}${host.slice(lowerDomain.length)}`
  })
}
