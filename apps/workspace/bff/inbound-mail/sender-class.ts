import type { InboundMailSenderClass, InboundSenderTrust, SenderFlag, SenderReason } from './inbound-mail-vocabulary'
import type { InboundMailWaitReason } from './inbound-mail-wire'
import { directFilingEnabled } from './direct-filing'

export const REPLAY_FLAGS: readonly SenderFlag[] = ['stale_date', 'date_out_of_range', 'message_id_reused', 'already_filed']

export interface SenderClassInput {
  trust: InboundSenderTrust
  reason: SenderReason
  senderUserId: string | null
  flags: readonly SenderFlag[]
  automatic: boolean
  writes: boolean
}

export function isVerifiedWriterEvidence(input: Omit<SenderClassInput, 'writes'>): boolean {
  if (input.trust !== 'member_verified' || input.reason !== 'dkim_pass' || !input.senderUserId || input.automatic) return false
  if (input.flags.some((flag) => REPLAY_FLAGS.includes(flag))) return false
  if (input.flags.includes('relaxed_alignment')) return false
  return !input.flags.includes('not_addressed_to_project')
}

export function senderClassOf(input: SenderClassInput): InboundMailSenderClass {
  if (input.trust === 'external_verified' || input.trust === 'external_unverified' || !input.senderUserId) return 'external'
  if (!input.writes) return 'office_member'
  return isVerifiedWriterEvidence(input) ? 'verified_writer' : 'unverified_writer'
}

export interface WaitReasonInput {
  senderClass: InboundMailSenderClass | null
  senderTrust: InboundSenderTrust | null
  senderFlags: readonly SenderFlag[]
  automatic: boolean
  directFiling?: boolean
}

function unverifiedWriterReason(mail: WaitReasonInput): InboundMailWaitReason {
  if (mail.senderTrust !== 'member_verified' || mail.senderFlags.includes('relaxed_alignment')) return 'signature'
  if (mail.senderFlags.includes('not_addressed_to_project') || mail.senderFlags.some((flag) => REPLAY_FLAGS.includes(flag))) return 'replay'
  return mail.automatic ? 'automatic' : 'signature'
}

export function senderWaitReason(mail: WaitReasonInput): InboundMailWaitReason | null {
  if (mail.senderFlags.includes('sender_unchecked')) return 'sender_unchecked'
  switch (mail.senderClass) {
    case 'verified_writer':
      return (mail.directFiling ?? directFilingEnabled()) ? 'not_filed' : 'paused'
    case 'unverified_writer':
      return unverifiedWriterReason(mail)
    case 'office_member':
      return 'no_write_rights'
    case 'external':
      return 'outside_office'
    default:
      return null
  }
}

export function expiryIsFinal(mail: { senderClass: InboundMailSenderClass | null; senderFlags: readonly SenderFlag[] }): boolean {
  return mail.senderClass === 'external' && !mail.senderFlags.includes('sender_unchecked')
}

export function dismissalIsFinal(mail: { senderTrust: InboundSenderTrust | null; senderFlags: readonly SenderFlag[] }): boolean {
  return mail.senderTrust === 'external_unverified' && !mail.senderFlags.includes('sender_unchecked')
}

export function onlySenderReleases(
  mail: { senderClass: InboundMailSenderClass | null; senderUserId: string | null },
  viewerUserId: string,
): boolean {
  return mail.senderClass === 'unverified_writer' && mail.senderUserId !== viewerUserId
}
