import type { SenderTrust, ThreadMatch } from './mail-threading'
import { domainOf, restsOnSignedHeader, signedHeaderSet, VERIFIED_SENDER_TRUSTS } from './mail-threading'

export const FOLLOW_INELIGIBILITY_REASONS = [
  'no_active_follow',
  'sender_not_verified',
  'match_not_reference',
  'header_not_signed',
  'flagged',
  'automatic',
  'new_participant_domain',
  'recipients_unchecked',
  'name_stop',
  'content_finding',
] as const
export type FollowIneligibilityReason = (typeof FOLLOW_INELIGIBILITY_REASONS)[number]

export const FOLLOW_REFUSING_FLAGS = [
  'not_addressed_to_project',
  'bcc_own',
  'stale_date',
  'date_out_of_range',
  'message_id_reused',
  'already_filed',
  'claims_member_name',
] as const

export const FOLLOW_REQUIRED_SIGNED_HEADERS = ['from', 'subject', 'date', 'message-id'] as const

export interface FollowCandidateMail {
  receivedAt: Date
  senderTrust: SenderTrust
  senderFlags: readonly string[]
  signedHeaders: readonly string[]
  automatic: boolean
  recipientHeaders: ReadonlyArray<'to' | 'cc'>
  participantAddresses: readonly string[]
  recipientCount: number
  checkedRecipientCount: number
  match: ThreadMatch | null
  subjectNameStops: readonly string[]
  contentFindings: number
}

export interface FollowedThread {
  id: string
  participantDomains: readonly string[]
}

export interface FollowRow {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
  endedAt: Date | null
}

export type FollowEligibility =
  | { eligible: true; follow: FollowRow }
  | {
      eligible: false
      reasons: FollowIneligibilityReason[]
      newDomains: string[]
    }

export interface FollowEligibilityContext {
  now: Date
  ownDomains: readonly string[]
}

export function followEligibility(
  mail: FollowCandidateMail,
  thread: FollowedThread,
  follows: readonly FollowRow[],
  context: FollowEligibilityContext
): FollowEligibility {
  const follow = earliestActiveFollow(follows, mail.receivedAt, context.now)
  const newDomains = newParticipantDomains(mail, thread, context.ownDomains)
  const reasons: FollowIneligibilityReason[] = []
  if (!follow) reasons.push('no_active_follow')
  if (!VERIFIED_SENDER_TRUSTS.includes(mail.senderTrust)) reasons.push('sender_not_verified')
  if (!mail.match || mail.match.threadId !== thread.id || mail.match.strength !== 'reference')
    reasons.push('match_not_reference')
  else if (!signatureCovers(mail, mail.match)) reasons.push('header_not_signed')
  if (FOLLOW_REFUSING_FLAGS.some((flag) => mail.senderFlags.includes(flag))) reasons.push('flagged')
  if (mail.automatic) reasons.push('automatic')
  if (newDomains.length > 0) reasons.push('new_participant_domain')
  if (mail.recipientCount > mail.checkedRecipientCount) reasons.push('recipients_unchecked')
  if (mail.subjectNameStops.length > 0) reasons.push('name_stop')
  if (mail.contentFindings > 0) reasons.push('content_finding')
  if (follow && reasons.length === 0) return { eligible: true, follow }
  return { eligible: false, reasons, newDomains }
}

export function earliestActiveFollow(follows: readonly FollowRow[], receivedAt: Date, now: Date): FollowRow | null {
  const active = follows.filter(
    (follow) =>
      follow.endedAt === null &&
      follow.expiresAt.getTime() > now.getTime() &&
      follow.createdAt.getTime() < receivedAt.getTime()
  )
  active.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  return active[0] ?? null
}

function signatureCovers(mail: FollowCandidateMail, match: ThreadMatch): boolean {
  if (!restsOnSignedHeader(match, mail)) return false
  const signed = signedHeaderSet(mail)
  if (!FOLLOW_REQUIRED_SIGNED_HEADERS.every((header) => signed.has(header))) return false
  return mail.recipientHeaders.length > 0 && mail.recipientHeaders.every((header) => signed.has(header))
}

export function newParticipantDomains(
  mail: Pick<FollowCandidateMail, 'participantAddresses'>,
  thread: FollowedThread,
  ownDomains: readonly string[]
): string[] {
  const known = new Set([...thread.participantDomains, ...ownDomains].map((domain) => domain.toLowerCase()))
  const fresh = new Set<string>()
  for (const address of mail.participantAddresses) {
    const domain = domainOf(address)
    if (!domain) fresh.add('')
    else if (!known.has(domain)) fresh.add(domain)
  }
  return [...fresh].sort()
}
