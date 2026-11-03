/**
 * Who a held mail names, as the receive job stores it (`./receive-job.ts`,
 * step 9): the participants a person is shown, the recipient count a follow
 * checks, the participant domains a thread match reads. Pure.
 */

import { domainOf } from '@/lib/mail-thread/mail-threading'
import type { MailParticipant } from './inbound-mail-vocabulary'
import type { MailHeaders } from './mime'

/**
 * The participants a person is shown: From, Reply-To, To and Cc (the Sender
 * field is the mailbox that submitted it, not a party), the project addresses
 * of this deployment taken out (B8: they are not people), every display name
 * redacted.
 */
export function mailParticipants(headers: MailHeaders, domain: string, redact: (text: string) => string): MailParticipant[] {
  const participants: MailParticipant[] = []
  for (const participant of headers.participants) {
    if (participant.role === 'sender') continue
    if (isOurDomain(participant.domain, domain)) continue
    participants.push({
      role: participant.role,
      name: participant.name ? redact(participant.name).slice(0, 300) : null,
      address: participant.address.slice(0, 320),
    })
  }
  return participants
}

/**
 * The To/Cc recipients the mail names, the project addresses taken out as
 * `mailParticipants` takes them out, at most 1000 (the CHECK). Exact while the
 * participant cap kept every recipient; past it, a project address the cap cut
 * is still counted, so the count only errs high: condition 5 of a follow
 * (`followEligibility`) refuses a mail with more recipients than it checked.
 */
export function recipientCountOf(headers: MailHeaders, domain: string): number {
  const own = headers.participants.filter(
    (participant) => (participant.role === 'to' || participant.role === 'cc') && isOurDomain(participant.domain, domain),
  ).length
  return Math.min(Math.max(headers.recipientCount - own, 0), 1000)
}

function isOurDomain(candidate: string | null, domain: string): boolean {
  return candidate !== null && (candidate === domain || candidate.endsWith(`.${domain}`))
}

/** Distinct participant domains in one form (`domainOf`), at most 50 (the CHECK). */
export function participantDomainsOf(participants: readonly MailParticipant[]): string[] {
  const domains = new Set<string>()
  for (const participant of participants) {
    const domain = domainOf(participant.address)
    if (domain) domains.add(domain)
  }
  return [...domains].slice(0, 50)
}
