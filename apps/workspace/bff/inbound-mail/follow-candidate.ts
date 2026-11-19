import 'server-only'

import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import {
  followEligibility,
  type FollowCandidateMail,
  type FollowEligibility,
} from '@/lib/mail-thread/follow-eligibility'
import type { ThreadMatch } from '@/lib/mail-thread/mail-threading'
import { rawHeaderFields } from './mime'
import { findThreadFollowContext, type ThreadFollowContext } from './repository'
import { mailScreeningFor } from './screening'
import { readStagedObject } from './staging'

export interface FollowJudgement {
  thread: ThreadFollowContext
  eligibility: FollowEligibility
}

export async function judgeFollow(
  mail: InboundMailRow,
  contentFindings: number,
  ownDomain: string,
  raw: Uint8Array | null,
  now: Date = new Date(),
  passedOver: ReadonlySet<string> = new Set(),
): Promise<FollowJudgement | null> {
  const match = mail.threadMatch.find((candidate) => candidate.strength === 'reference')
  if (!match || !mail.senderTrust) return null
  const found = await findThreadFollowContext(mail.projectId, match.threadId)
  const thread = found && { ...found, follows: found.follows.filter((follow) => !passedOver.has(follow.id)) }
  if (!thread || thread.follows.length === 0) return null
  const screening = await mailScreeningFor(mail.organizationId, mail.projectId)
  const candidate: FollowCandidateMail = {
    receivedAt: new Date(mail.receivedAt),
    senderTrust: mail.senderTrust,
    senderFlags: mail.senderFlags,
    signedHeaders: mail.signedHeaders,
    automatic: mail.automatic,
    recipientHeaders: await recipientHeadersOf(mail, raw),
    participantAddresses: [
      ...(mail.senderAddress ? [mail.senderAddress] : []),
      ...mail.participants
        .filter((participant) => participant.role !== 'reply_to')
        .map((participant) => participant.address),
    ],
    recipientCount: mail.recipientCount,
    checkedRecipientCount: mail.participants.filter((participant) => participant.role === 'to' || participant.role === 'cc').length,
    match: match as ThreadMatch,
    subjectNameStops: screening.nameStops(mail.baseSubject ?? ''),
    contentFindings,
  }
  const eligibility = followEligibility(
    candidate,
    { id: thread.threadId, participantDomains: thread.participantDomains },
    thread.follows,
    { now, ownDomains: [ownDomain] },
  )
  return { thread, eligibility }
}

async function recipientHeadersOf(mail: InboundMailRow, raw: Uint8Array | null): Promise<Array<'to' | 'cc'>> {
  const bytes = raw ?? (mail.rawStorageKey ? await readStagedObject(mail.stagingBucket, mail.rawStorageKey) : null)
  const fields = bytes ? rawHeaderFields(bytes) : null
  if (!fields) return []
  return (['to', 'cc'] as const).filter((name) => fields.some((field) => field.name === name))
}
