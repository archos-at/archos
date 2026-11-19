import type { InboundMailSenderRiskView, InboundMailSenderView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import type { ImpersonationBasis, SenderFlag } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { FOLLOW_REFUSING_FLAGS } from '@/lib/mail-thread/follow-eligibility'
import { isOwnBccCopy } from '@/lib/mail-thread/mail-threading'

export type MailClaim = 'own' | 'colleague' | null

export function mailClaimOf(view: Pick<InboundMailSenderRiskView, 'onlySenderReleases' | 'ownClaimedMail'>): MailClaim {
  if (view.onlySenderReleases) return 'colleague'
  return view.ownClaimedMail ? 'own' : null
}

export type SenderTrustLine =
  | { kind: 'verified'; domain: string }
  | { kind: 'bcc_own'; domain: string | null }
  | { kind: 'member_unverified' }
  | { kind: 'impersonation'; name: string; basis: ImpersonationBasis }
  | { kind: 'own_rejected' }
  | { kind: 'unverified' }

export type SenderTone = 'confirmed' | 'neutral' | 'warning'

export function senderTrustLine(sender: InboundMailSenderView, impersonation: InboundMailView['impersonation'], claim: MailClaim = null): SenderTrustLine {
  if (impersonation === 'rejected_signature' && claim === 'own') return { kind: 'own_rejected' }
  if (impersonation) return { kind: 'impersonation', name: sender.name?.trim() || sender.address, basis: impersonation }
  if (claim !== 'colleague' && isOwnBccCopy({ senderTrust: sender.trust, senderFlags: sender.flags })) {
    return { kind: 'bcc_own', domain: sender.signerDomain ?? sender.domain }
  }
  if (sender.trust === 'member_verified' || sender.trust === 'external_verified') {
    return { kind: 'verified', domain: sender.signerDomain ?? sender.domain ?? sender.address }
  }
  return sender.trust === 'member_unverified' ? { kind: 'member_unverified' } : { kind: 'unverified' }
}

export function senderTone(line: SenderTrustLine): SenderTone {
  switch (line.kind) {
    case 'verified':
    case 'bcc_own':
      return 'confirmed'
    case 'impersonation':
    case 'own_rejected':
    case 'member_unverified':
      return 'warning'
    case 'unverified':
      return 'neutral'
  }
}

export function senderFlagLines(sender: Pick<InboundMailSenderView, 'trust' | 'flags'>): SenderFlag[] {
  const ownBcc = isOwnBccCopy({ senderTrust: sender.trust, senderFlags: sender.flags })
  const shown: SenderFlag[] = []
  if (sender.flags.includes('not_addressed_to_project') && !ownBcc) shown.push('not_addressed_to_project')
  if (sender.flags.includes('stale_date')) shown.push('stale_date')
  else if (sender.flags.includes('date_out_of_range')) shown.push('date_out_of_range')
  if (sender.flags.includes('already_filed')) shown.push('already_filed')
  return shown
}

export function senderDisplayName(sender: Pick<InboundMailSenderView, 'name' | 'address'>): string {
  const name = sender.name?.trim()
  if (name) return name
  const at = sender.address.indexOf('@')
  return at > 0 ? sender.address.slice(0, at) : sender.address
}

export function followOffered(view: { sender: Pick<InboundMailSenderView, 'trust' | 'flags'> | null; automatic: boolean }): boolean {
  if (!view.sender || view.automatic) return false
  if (view.sender.trust !== 'member_verified' && view.sender.trust !== 'external_verified') return false
  return !view.sender.flags.some((flag) => (FOLLOW_REFUSING_FLAGS as readonly string[]).includes(flag))
}
