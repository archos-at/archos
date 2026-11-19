import { latinize } from '@/lib/text/latinize'
import { isOwnBccCopy } from '@/lib/mail-thread/mail-threading'
import type { ImpersonationBasis, SenderFlag, SenderReason, SenderRiskLevel, SenderTrust } from './inbound-mail-vocabulary'

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

export function isRejectedSignature(reason: SenderReason): boolean {
  return reason === 'dkim_fail' || reason === 'dkim_policy' || reason === 'dkim_weak_algorithm' || reason === 'dkim_short_key'
}

export function impersonationOf(sender: SenderFacts): ImpersonationBasis | null {
  if (sender.flags.includes('claims_member_name')) return 'member_name'
  if (isRejectedSignature(sender.reason)) return 'rejected_signature'
  return null
}

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

export function claimsMemberName(displayName: string | null, memberNames: Iterable<string>): boolean {
  if (!displayName) return false
  const claimed = new Set(nameWords(displayName))
  if (claimed.size < MIN_NAME_WORDS) return false
  for (const name of memberNames) {
    if (name.includes('@')) continue
    const words = nameWords(name).filter((word) => word.length >= MIN_WORD_LENGTH)
    if (words.length < MIN_NAME_WORDS) continue
    const surname = words.length - 1
    if (words.every((word, index) => claimsWord(claimed, word, index !== surname))) return true
  }
  return false
}
