/**
 * The sender rule (ADR-0137, amendment of 2026-11-03): who a held mail's
 * sender is to its project, judged once by the receive job when it holds the
 * mail (`inbound_mails.sender_class`, migration 0194), and what each class
 * means to the person reading it.
 *
 * | Class | When | What happens |
 * |---|---|---|
 * | `verified_writer` | DKIM pass by the From domain itself (strict alignment), From = a member who may write in the project, the signed To or Cc names the project, no replay or date flag, not automatic | filed directly, as that member (`./sender-file-job.ts`); with direct filing switched off (`INBOUND_MAIL_DIRECT_FILING=false`), held for the project's writers like an office member's, wait reason `paused` |
 * | `unverified_writer` | From = such a member, but no aligned pass, or one by a parent or subdomain only (`relaxed_alignment`), or not addressed to the project (their own Bcc copy included), or a replay or date flag, or automatic | held; only that member releases it, saying they sent it |
 * | `office_member` | From = a member without write rights in the project | held for the project's writers |
 * | `external` | From = nobody in the office | held for the project's writers; discarded after 14 days |
 *
 * A member's own Bcc copy (`bcc_own`) is NOT a direct filing's evidence: the
 * flag is told apart from a recipient re-sending the member's signed mail to
 * someone else by time alone, and time does not tell them apart. Whoever got
 * the mail could re-send its unchanged bytes to the project within the window
 * and have it filed as the member. A Bcc copy waits for its member's one press
 * („Ja, gesendet“), as following refuses it (`follow-eligibility.ts`).
 *
 * The database holds the same rule (`inbound_mails_verified_writer_evidence`),
 * so a class this module would not give is a refused statement, not a quiet
 * filing. The kill switch never changes the class: it is evidence, and the
 * switch only decides whether the sender's filing is queued
 * (`./receive-sender.ts`), so switching it off is never stricter than the
 * rule before direct filing: any writer may file such a mail. No session, no
 * database; the one outside read is the kill switch (`./direct-filing.ts`),
 * for the wait reason, unless the caller states it.
 */

import type { InboundMailSenderClass, InboundSenderTrust, SenderFlag, SenderReason } from './inbound-mail-vocabulary'
import type { InboundMailWaitReason } from './inbound-mail-wire'
import { directFilingEnabled } from './direct-filing'

/** Flags that make a signed writer's mail one that may have been replayed or misdated: it waits for them. */
export const REPLAY_FLAGS: readonly SenderFlag[] = ['stale_date', 'date_out_of_range', 'message_id_reused', 'already_filed']

/** What the class is judged from: the stored verdict, and the write right the hold asked WorkOS about. */
export interface SenderClassInput {
  trust: InboundSenderTrust
  reason: SenderReason
  senderUserId: string | null
  flags: readonly SenderFlag[]
  automatic: boolean
  /**
   * The From's member holds `project:documents:write` on the project now. A
   * check WorkOS did not answer is never this "false": the receive job waits
   * it out, and past its fault budget holds the mail flagged `sender_unchecked`
   * (`./receive-sender.ts`, `./receive-faults.ts`).
   */
  writes: boolean
}

/** Whether the verdict is a direct filing's evidence: the CHECK `inbound_mails_verified_writer_evidence`, in code. */
export function isVerifiedWriterEvidence(input: Omit<SenderClassInput, 'writes'>): boolean {
  if (input.trust !== 'member_verified' || input.reason !== 'dkim_pass' || !input.senderUserId || input.automatic) return false
  if (input.flags.some((flag) => REPLAY_FLAGS.includes(flag))) return false
  // Strict alignment only: a subdomain's or a parent's key (a newsletter service's, often) does not file as a member.
  if (input.flags.includes('relaxed_alignment')) return false
  // A Bcc copy (`bcc_own`) is no exception: see the module header.
  return !input.flags.includes('not_addressed_to_project')
}

/** The class of a held mail's sender. See the module header. */
export function senderClassOf(input: SenderClassInput): InboundMailSenderClass {
  if (input.trust === 'external_verified' || input.trust === 'external_unverified' || !input.senderUserId) return 'external'
  if (!input.writes) return 'office_member'
  return isVerifiedWriterEvidence(input) ? 'verified_writer' : 'unverified_writer'
}

/** What the wait reason reads of a held mail: its class and the verdict it was judged from. */
export interface WaitReasonInput {
  senderClass: InboundMailSenderClass | null
  senderTrust: InboundSenderTrust | null
  senderFlags: readonly SenderFlag[]
  automatic: boolean
  /** Direct filing is switched on (`./direct-filing.ts`); read from the environment when not given. */
  directFiling?: boolean
}

/**
 * Why a writer's mail was not filed directly, in the order a reader can act
 * on: no signature by the address's own domain (`signature`, a subdomain's
 * key included), a signed mail that reads as re-sent or misdated (`replay`:
 * addressed to others, a Bcc copy included, or a replay or date flag), or one
 * sent automatically (`automatic`).
 */
function unverifiedWriterReason(mail: WaitReasonInput): InboundMailWaitReason {
  if (mail.senderTrust !== 'member_verified' || mail.senderFlags.includes('relaxed_alignment')) return 'signature'
  if (mail.senderFlags.includes('not_addressed_to_project') || mail.senderFlags.some((flag) => REPLAY_FLAGS.includes(flag))) return 'replay'
  return mail.automatic ? 'automatic' : 'signature'
}

/**
 * Why a held mail waits, as the E-Mail-Eingang and the Postfach say it: a
 * writer's mail that was not filed directly (see {@link unverifiedWriterReason}),
 * a member who may not write here, or a sender outside the office. A verified
 * writer's mail waits only for what its sender's filing left (a flagged part,
 * a part with no folder): null, unless direct filing is switched off, when it
 * waits for any writer (`paused`).
 */
export function senderWaitReason(mail: WaitReasonInput): InboundMailWaitReason | null {
  switch (mail.senderClass) {
    case 'verified_writer':
      return (mail.directFiling ?? directFilingEnabled()) ? null : 'paused'
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

/**
 * Whether only the mail's own member may file or restore it (rule 2): it
 * claims a writer it could not prove to be. Anyone else may dismiss it.
 */
export function onlySenderReleases(
  mail: { senderClass: InboundMailSenderClass | null; senderUserId: string | null },
  viewerUserId: string,
): boolean {
  return mail.senderClass === 'unverified_writer' && mail.senderUserId !== viewerUserId
}
