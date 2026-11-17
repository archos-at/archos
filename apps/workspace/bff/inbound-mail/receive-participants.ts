import { domainOf } from '@/lib/mail-thread/mail-threading'
import type { MailParticipant } from './inbound-mail-vocabulary'
import type { MailHeaders } from './mime'

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

export function recipientCountOf(headers: MailHeaders, domain: string): number {
  const own = headers.participants.filter(
    (participant) => (participant.role === 'to' || participant.role === 'cc') && isOurDomain(participant.domain, domain),
  ).length
  return Math.min(Math.max(headers.recipientCount - own, 0), 1000)
}

function isOurDomain(candidate: string | null, domain: string): boolean {
  return candidate !== null && (candidate === domain || candidate.endsWith(`.${domain}`))
}

export function participantDomainsOf(participants: readonly MailParticipant[]): string[] {
  const domains = new Set<string>()
  for (const participant of participants) {
    const domain = domainOf(participant.address)
    if (domain) domains.add(domain)
  }
  return [...domains].slice(0, 50)
}
