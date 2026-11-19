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

function nameWords(name: string): string[] {
  return latinize(name.normalize('NFKC'))
    .toLowerCase()
    .split(/[^a-z]+/u)
    .filter((word) => word.length > 0)
}

const MIN_NAME_WORDS = 2
const MIN_WORD_LENGTH = 2

export function claimsMemberName(displayName: string | null, memberNames: Iterable<string>): boolean {
  if (!displayName) return false
  const claimed = new Set(nameWords(displayName))
  if (claimed.size < MIN_NAME_WORDS) return false
  for (const name of memberNames) {
    if (name.includes('@')) continue
    const words = nameWords(name).filter((word) => word.length >= MIN_WORD_LENGTH)
    if (words.length >= MIN_NAME_WORDS && words.every((word) => claimed.has(word))) return true
  }
  return false
}
