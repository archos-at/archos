import { latinize } from '@/lib/text/latinize'
import { isOwnBccCopy } from '@/lib/mail-thread/mail-threading'
import { impersonationOf } from './impersonation'
import type { SenderFlag, SenderReason, SenderRiskLevel, SenderTrust } from './inbound-mail-vocabulary'

export interface SenderFacts {
  trust: SenderTrust
  reason: SenderReason
  flags: readonly SenderFlag[]
}

export function senderFactsOf(mail: {
  senderTrust: SenderTrust | null
  senderReason: SenderReason | null
  senderFlags: readonly SenderFlag[]
}): SenderFacts | null {
  return mail.senderTrust && mail.senderReason ? { trust: mail.senderTrust, reason: mail.senderReason, flags: mail.senderFlags } : null
}

export { impersonationOf, isRejectedSignature } from './impersonation'

export function senderNeedsAcknowledgement(sender: SenderFacts): boolean {
  if (sender.trust === 'member_unverified') return true
  if (impersonationOf(sender) !== null) return true
  if (sender.flags.includes('not_addressed_to_project') && !isOwnBccCopy({ senderTrust: sender.trust, senderFlags: sender.flags })) {
    return true
  }
  return sender.flags.includes('stale_date')
}

export function senderRiskLevel(sender: SenderFacts | null): SenderRiskLevel {
  if (!sender) return 'none'
  if (impersonationOf(sender) !== null) return 'impersonation'
  return senderNeedsAcknowledgement(sender) ? 'caution' : 'none'
}

const LOOK_ALIKES: Readonly<Record<string, string>> = {
  А: 'A', а: 'a', В: 'B', Е: 'E', е: 'e', Ё: 'E', ё: 'e', І: 'I', і: 'i', Ї: 'I', ї: 'i', Ј: 'J', ј: 'j',
  К: 'K', к: 'k', М: 'M', м: 'm', Н: 'H', н: 'h', О: 'O', о: 'o', Р: 'P', р: 'p', С: 'C', с: 'c', Т: 'T', т: 't',
  У: 'Y', у: 'y', Х: 'X', х: 'x', Ѕ: 'S', ѕ: 's', Ь: 'b', ь: 'b', Ԁ: 'D', ԁ: 'd', Һ: 'H', һ: 'h', Ү: 'Y', ү: 'y',
  Ԛ: 'Q', ԛ: 'q', Ԝ: 'W', ԝ: 'w', Ӏ: 'I', ӏ: 'l',
  Α: 'A', α: 'a', Β: 'B', β: 'b', Ε: 'E', ε: 'e', Ζ: 'Z', Η: 'H', Ι: 'I', ι: 'i', Κ: 'K', κ: 'k', Μ: 'M', Ν: 'N',
  ν: 'v', Ο: 'O', ο: 'o', Ρ: 'P', ρ: 'p', Τ: 'T', τ: 't', Υ: 'Y', υ: 'u', Χ: 'X', χ: 'x',
}

const LOOK_ALIKE = new RegExp(`[${Object.keys(LOOK_ALIKES).join('')}]`, 'gu')

function nameWords(name: string): string[] {
  const visible = name.normalize('NFKC').replace(/\p{Cf}/gu, '')
  return latinize(visible.replace(LOOK_ALIKE, (letter) => LOOK_ALIKES[letter] ?? letter))
    .toLowerCase()
    .split(/[^a-z]+/u)
    .filter((word) => word.length > 0)
}

const MIN_NAME_WORDS = 2
const MIN_WORD_LENGTH = 2

function claimsWord(claimed: ReadonlySet<string>, word: string, initialSuffices: boolean): boolean {
  return claimed.has(word) || (initialSuffices && claimed.has(word[0]))
}

function claimsName(claimed: ReadonlySet<string>, name: string): boolean {
  if (name.includes('@')) return false
  const words = nameWords(name).filter((word) => word.length >= MIN_WORD_LENGTH)
  if (words.length < MIN_NAME_WORDS) return false
  const surname = words.length - 1
  return words.every((word, index) => claimsWord(claimed, word, index !== surname))
}

function claimedWords(displayName: string | null): ReadonlySet<string> | null {
  if (!displayName) return null
  const claimed = new Set(nameWords(displayName))
  return claimed.size < MIN_NAME_WORDS ? null : claimed
}

export function claimsMemberName(displayName: string | null, memberNames: Iterable<string>): boolean {
  const claimed = claimedWords(displayName)
  if (!claimed) return false
  for (const name of memberNames) if (claimsName(claimed, name)) return true
  return false
}

export function claimedMemberIds(displayName: string | null, members: Iterable<{ userId: string; name: string }>): string[] {
  const claimed = claimedWords(displayName)
  if (!claimed) return []
  return [...members].filter((member) => claimsName(claimed, member.name)).map((member) => member.userId)
}
