import 'server-only'

import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { inboundMailDomain } from '@/lib/inbound-mail/address'
import { queueFollowIfEligible } from '@/lib/inbound-mail/follow-candidate'
import { findPartSummaries, findThreadCandidates } from '@/lib/inbound-mail/repository'
import { matchThread, type ThreadingMessage, type ThreadMatch } from './mail-threading'
import { findWaitingMailsNearThread, recordThreadMatch, type ThreadKeysOf } from './repository'

const MAX_STORED_THREAD_MATCHES = 50

export async function matchProjectThreads(projectId: string, message: ThreadingMessage): Promise<ThreadMatch[]> {
  const candidates = await findThreadCandidates(projectId, {
    messageIds: [message.messageId, ...message.inReplyTo, ...message.references].filter((id): id is string => !!id),
    threadIndexGuid: message.threadIndexGuid,
    baseSubject: message.baseSubject,
    participants: message.participants,
  })
  return matchThread(message, candidates).slice(0, MAX_STORED_THREAD_MATCHES)
}

export function threadingMessageOfMail(mail: InboundMailRow): ThreadingMessage {
  return {
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.referenceIds,
    threadIndexGuid: mail.threadIndexGuid,
    baseSubject: mail.baseSubject ?? '',
    participants: mail.participants.map((participant) => participant.address),
    sentAt: new Date(mail.sentAt ?? mail.receivedAt),
  }
}

const referenced = (matches: readonly ThreadMatch[]): string | null =>
  matches.find((match) => match.strength === 'reference')?.threadId ?? null

const sameMatches = (a: readonly ThreadMatch[], b: readonly ThreadMatch[]): boolean => JSON.stringify(a) === JSON.stringify(b)

export async function rematchWaitingMails(projectId: string, thread: ThreadKeysOf): Promise<number> {
  let changed = 0
  for (const mail of await findWaitingMailsNearThread(projectId, thread)) {
    const matches = await matchProjectThreads(projectId, threadingMessageOfMail(mail))
    if (sameMatches(mail.threadMatch, matches) || !(await recordThreadMatch(mail.id, matches))) continue
    changed += 1
    const reference = referenced(matches)
    if (reference && reference !== referenced(mail.threadMatch)) await followNewReference({ ...mail, threadMatch: matches })
  }
  return changed
}

async function followNewReference(mail: InboundMailRow): Promise<void> {
  const domain = inboundMailDomain()
  if (!domain || mail.senderClass === 'verified_writer') return
  await queueFollowIfEligible(mail, await findPartSummaries(mail.id), domain, null)
}

export async function rematchAfterWrite(projectId: string, threads: readonly ThreadKeysOf[]): Promise<void> {
  for (const thread of threads) {
    await rematchWaitingMails(projectId, thread).catch((error: unknown) => {
      console.warn(`[mail-thread] the waiting mails of thread ${thread.id} were not matched again; they keep their match`, error)
    })
  }
}
