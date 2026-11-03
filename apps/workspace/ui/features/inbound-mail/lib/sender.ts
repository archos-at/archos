/**
 * What the E-Mail-Eingang says about who a mail is from (DECISION §3
 * „Sender trust“, D4, C2), as data the components word through the
 * dictionary.
 *
 * DKIM proves a domain, never a person, so no label claims more than the
 * domain: „Domain bestätigt: statik-weber.at“, never „Absender bestätigt“.
 * „Gibt sich als … aus“ is reserved for the two results that are evidence of
 * a forgery (a signature that failed, or a DMARC policy that refused the
 * mail); a member's address that simply carries no signature is „Mitglied ·
 * Domain nicht bestätigt“, because most unsigned mail is a misconfigured
 * server and not an attack.
 *
 * Pure, and wording only: whether the sender reads as an impersonation, and
 * whether filing needs the person's acknowledgement, are the server's
 * (`lib/inbound-mail/sender-risk.ts`), read off the view as `impersonation`
 * and `needsSenderAcknowledgement`.
 */

import type { InboundMailSenderRiskView, InboundMailSenderView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import type { ImpersonationBasis, SenderFlag } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { FOLLOW_REFUSING_FLAGS } from '@/lib/mail-thread/follow-eligibility'
import { isOwnBccCopy } from '@/lib/mail-thread/mail-threading'

/**
 * Who the reader is to a mail that claims a writer it could not prove to be
 * (`senderClass: 'unverified_writer'`): `own`, the member it claims, who is
 * asked „Haben Sie diese E-Mail gesendet?“ and alone may file it;
 * `colleague`, anyone else, who may only dismiss it (`onlySenderReleases`).
 * Null for every other mail. Each viewer reads one message about it: the
 * member the question, a colleague who must wait for that member.
 */
export type MailClaim = 'own' | 'colleague' | null

export function mailClaimOf(view: Pick<InboundMailSenderRiskView, 'senderClass' | 'onlySenderReleases'>): MailClaim {
  if (view.onlySenderReleases) return 'colleague'
  return view.senderClass === 'unverified_writer' ? 'own' : null
}

/** The one line that says how far the sender is confirmed. */
export type SenderTrustLine =
  /** An aligned DKIM pass: the signing domain is named. */
  | { kind: 'verified'; domain: string }
  /** A member's own Bcc copy of a mail they sent elsewhere (D4). */
  | { kind: 'bcc_own'; domain: string | null }
  /** A member's address without a valid signature: shown as a member, unconfirmed. */
  | { kind: 'member_unverified' }
  /** The server reads the mail as someone pretending (a rejected signature, or a member's name on another address). */
  | { kind: 'impersonation'; name: string; basis: ImpersonationBasis }
  /** The reader's own address, and their domain rejected the mail: said to them as theirs, never as „gibt sich als Sie aus“. */
  | { kind: 'own_rejected' }
  /** Anyone else whose domain did not sign. */
  | { kind: 'unverified' }

/** How the line is drawn: a quiet fact, or a warning the reader must see before filing. */
export type SenderTone = 'confirmed' | 'neutral' | 'warning'

/**
 * The line for this sender. An impersonation (`view.impersonation`, the
 * server's) outranks everything else: a member's name on an outsider's
 * address may well be „Domain bestätigt“ for the outsider's own domain, and
 * that line must not be the one a person reads. The member a rejected mail
 * claims reads it as their own address (`own_rejected`), and a colleague
 * never reads another member's Bcc copy as „Ihre eigene E-Mail“.
 */
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

/**
 * The flags worth a line of their own under the trust line, in reading order.
 * `bcc_own` is said by the trust line itself, and `not_addressed_to_project`
 * belongs to it there; `message_id_reused` alone says nothing a person can
 * act on (the genuine message is never blocked), so it is not shown.
 */
export function senderFlagLines(sender: Pick<InboundMailSenderView, 'trust' | 'flags'>): SenderFlag[] {
  const ownBcc = isOwnBccCopy({ senderTrust: sender.trust, senderFlags: sender.flags })
  const shown: SenderFlag[] = []
  if (sender.flags.includes('not_addressed_to_project') && !ownBcc) shown.push('not_addressed_to_project')
  if (sender.flags.includes('stale_date')) shown.push('stale_date')
  else if (sender.flags.includes('date_out_of_range')) shown.push('date_out_of_range')
  if (sender.flags.includes('already_filed')) shown.push('already_filed')
  return shown
}

/** Initials-free fallback name for a sender: the display name, else the local part of the address. */
export function senderDisplayName(sender: Pick<InboundMailSenderView, 'name' | 'address'>): string {
  const name = sender.name?.trim()
  if (name) return name
  const at = sender.address.indexOf('@')
  return at > 0 ? sender.address.slice(0, at) : sender.address
}

/**
 * Whether „Diesem E-Mail-Verlauf folgen“ is offered after this mail's text was
 * filed (DECISION §9 step 7): only where a later reply from this sender could
 * ever qualify (D31 conditions 2 and 4). A stranger whose domain did not sign,
 * a member's Bcc copy, a replayed or misdated mail and a machine never could,
 * so offering the follow there would promise what it cannot do.
 */
export function followOffered(view: { sender: Pick<InboundMailSenderView, 'trust' | 'flags'> | null; automatic: boolean }): boolean {
  if (!view.sender || view.automatic) return false
  if (view.sender.trust !== 'member_verified' && view.sender.trust !== 'external_verified') return false
  return !view.sender.flags.some((flag) => (FOLLOW_REFUSING_FLAGS as readonly string[]).includes(flag))
}
