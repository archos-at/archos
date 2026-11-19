import 'server-only'

import { and, count, eq, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { inboundMailDecisions, inboundMailParts, inboundMails, type InboundMailDecisionRow, type NewInboundMailDecisionRow } from '@/lib/db/schema/inbound-mail'
import { mailThreadFollows, mailThreads, type MailThreadFollowRow, type NewMailThreadFollowRow } from '@/lib/db/schema/mail-thread'
import { projectFolders } from '@/lib/db/schema/project-folders'
import type { DocumentReader } from '@/lib/documents/document-reader'
import { documentVisibleTo } from '@/lib/documents/visibility'
import { MAIL_THREAD_FOLLOW_PROJECT_DAILY_CAP, type MailThreadFollowEndReason } from './mail-thread-vocabulary'

const DAY_MS = 24 * 60 * 60 * 1000

export async function findRunningFollow(threadId: string, userId: string): Promise<MailThreadFollowRow | null> {
  const [row] = await getDb()
    .select()
    .from(mailThreadFollows)
    .where(
      and(
        eq(mailThreadFollows.threadId, threadId),
        eq(mailThreadFollows.userId, userId),
        isNull(mailThreadFollows.endedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function findFollow(projectId: string, followId: string): Promise<MailThreadFollowRow | null> {
  const [row] = await getDb()
    .select()
    .from(mailThreadFollows)
    .where(and(eq(mailThreadFollows.projectId, projectId), eq(mailThreadFollows.id, followId)))
    .limit(1)
  return row ?? null
}

export async function startFollow(row: NewMailThreadFollowRow): Promise<MailThreadFollowRow | null> {
  const [inserted] = await getDb().insert(mailThreadFollows).values(row).onConflictDoNothing().returning()
  return inserted ?? null
}

export async function renewFollow(followId: string, until: Date, now: Date): Promise<MailThreadFollowRow | null> {
  const [renewed] = await getDb()
    .update(mailThreadFollows)
    .set({
      expiresAt: sql`GREATEST(${until.toISOString()}::timestamptz, ${mailThreadFollows.expiresAt})`,
      renewedAt: now,
      expiringNotifiedAt: null,
    })
    .where(and(eq(mailThreadFollows.id, followId), isNull(mailThreadFollows.endedAt)))
    .returning()
  return renewed ?? null
}

export async function extendRunningFollows(threadId: string, until: Date, now: Date): Promise<MailThreadFollowRow[]> {
  return getDb()
    .update(mailThreadFollows)
    .set({ expiresAt: until, expiringNotifiedAt: null })
    .where(
      and(
        eq(mailThreadFollows.threadId, threadId),
        isNull(mailThreadFollows.endedAt),
        gt(mailThreadFollows.expiresAt, now),
        lt(mailThreadFollows.expiresAt, until),
      ),
    )
    .returning()
}

export interface FollowEnd {
  reason: MailThreadFollowEndReason
  endedBy: string | null
}

export async function endFollow(followId: string, end: FollowEnd, now: Date = new Date()): Promise<MailThreadFollowRow | null> {
  const [ended] = await getDb()
    .update(mailThreadFollows)
    .set({ endedAt: now, endedBy: end.endedBy, endedReason: end.reason })
    .where(and(eq(mailThreadFollows.id, followId), isNull(mailThreadFollows.endedAt)))
    .returning()
  return ended ?? null
}

export type ThreadDocumentState = 'live' | 'gone' | 'unseen'

export async function findThreadDocumentState(
  projectId: string,
  threadId: string,
  reader: DocumentReader,
): Promise<ThreadDocumentState> {
  const db = getDb()
  const [thread] = await db
    .select({ documentId: mailThreads.documentId })
    .from(mailThreads)
    .where(and(eq(mailThreads.projectId, projectId), eq(mailThreads.id, threadId)))
    .limit(1)
  if (!thread?.documentId) return 'gone'
  const [document] = await db
    .select({ lifecycle: documents.lifecycle, folderBinnedAt: projectFolders.deletedAt })
    .from(documents)
    .leftJoin(projectFolders, eq(projectFolders.id, documents.folderId))
    .where(and(eq(documents.id, thread.documentId), eq(documents.projectId, projectId), documentVisibleTo(reader)))
    .limit(1)
  if (!document) return 'unseen'
  return document.lifecycle === 'active' && document.folderBinnedAt === null ? 'live' : 'gone'
}

export interface FollowDecisionInput {
  follow: { id: string; userId: string; threadId: string }
  mail: { id: string; organizationId: string; projectId: string; receivedAt: Date }
  partId: string
  decision: Pick<NewInboundMailDecisionRow, 'id' | 'messageText' | 'documentType'>
  attachments?: readonly FollowAttachmentDecision[]
  claimExpiresAt: Date
  now: Date
}

export type FollowAttachmentDecision = Pick<
  NewInboundMailDecisionRow,
  'id' | 'partId' | 'folderId' | 'folderPath' | 'fileName' | 'targetDocumentId' | 'documentType'
>

export type FollowDecisionWrite =
  | { kind: 'written'; decision: InboundMailDecisionRow; attachments: InboundMailDecisionRow[] }
  | { kind: 'follow_not_running' }
  | { kind: 'follow_cap' }
  | { kind: 'project_cap' }
  | { kind: 'not_waiting' }

class FollowDecisionRefused extends Error {
  constructor(readonly outcome: Exclude<FollowDecisionWrite, { kind: 'written' }>) {
    super(outcome.kind)
  }
}

export async function writeFollowDecision(input: FollowDecisionInput): Promise<FollowDecisionWrite> {
  const { follow, mail, now } = input
  const since = new Date(now.getTime() - DAY_MS)
  try {
    return await getDb().transaction(async (tx) => {
      const [running] = await tx
        .select()
        .from(mailThreadFollows)
        .where(eq(mailThreadFollows.id, follow.id))
        .for('update')
        .limit(1)
      if (
        !running ||
        running.endedAt !== null ||
        running.threadId !== follow.threadId ||
        running.userId !== follow.userId ||
        new Date(running.expiresAt).getTime() <= now.getTime() ||
        new Date(running.createdAt).getTime() >= mail.receivedAt.getTime()
      )
        throw new FollowDecisionRefused({ kind: 'follow_not_running' })

      const [held] = await tx
        .select({ status: inboundMails.status })
        .from(inboundMails)
        .where(eq(inboundMails.id, mail.id))
        .for('update')
        .limit(1)
      if (held?.status !== 'waiting') throw new FollowDecisionRefused({ kind: 'not_waiting' })

      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inbound_mail_follow:${mail.projectId}`}, 0))`,
      )
      const [own] = await tx
        .select({ appended: count() })
        .from(inboundMailDecisions)
        .where(
          and(
            eq(inboundMailDecisions.followId, follow.id),
            isNotNull(inboundMailDecisions.threadAction),
            gt(inboundMailDecisions.decidedAt, since),
          ),
        )
      if (Number(own?.appended ?? 0) >= running.dailyCap) throw new FollowDecisionRefused({ kind: 'follow_cap' })
      const [project] = await tx
        .select({ appended: count() })
        .from(inboundMailDecisions)
        .where(
          and(
            eq(inboundMailDecisions.projectId, mail.projectId),
            eq(inboundMailDecisions.via, 'follow'),
            isNotNull(inboundMailDecisions.threadAction),
            gt(inboundMailDecisions.decidedAt, since),
          ),
        )
      if (Number(project?.appended ?? 0) >= MAIL_THREAD_FOLLOW_PROJECT_DAILY_CAP)
        throw new FollowDecisionRefused({ kind: 'project_cap' })

      const [decision] = await tx
        .insert(inboundMailDecisions)
        .values({
          ...input.decision,
          organizationId: mail.organizationId,
          projectId: mail.projectId,
          mailId: mail.id,
          partId: input.partId,
          action: 'file',
          decidedBy: follow.userId,
          via: 'follow',
          followId: follow.id,
          threadAction: 'append',
          mailThreadId: follow.threadId,
          decidedAt: now,
        })
        .returning()
      if (!decision) throw new Error(`the follow decision about part ${input.partId} was not written`)
      const claimed = await tx
        .update(inboundMailParts)
        .set({
          state: 'filing',
          decisionId: decision.id,
          claimExpiresAt: input.claimExpiresAt,
          lastFailure: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(inboundMailParts.id, input.partId),
            eq(inboundMailParts.mailId, mail.id),
            eq(inboundMailParts.kind, 'message'),
            eq(inboundMailParts.state, 'waiting'),
          ),
        )
        .returning({ id: inboundMailParts.id })
      if (claimed.length !== 1) throw new FollowDecisionRefused({ kind: 'not_waiting' })

      const planned = input.attachments ?? []
      const waiting = planned.length === 0 ? [] : await tx
        .select({ id: inboundMailParts.id })
        .from(inboundMailParts)
        .where(
          and(
            eq(inboundMailParts.mailId, mail.id),
            eq(inboundMailParts.kind, 'attachment'),
            eq(inboundMailParts.state, 'waiting'),
            inArray(inboundMailParts.id, planned.map((attachment) => attachment.partId)),
          ),
        )
        .for('update')
      const stillWaiting = new Set(waiting.map((part) => part.id))
      const attachments: InboundMailDecisionRow[] = []
      for (const attachment of planned.filter((candidate) => stillWaiting.has(candidate.partId))) {
        const [filed] = await tx
          .insert(inboundMailDecisions)
          .values({
            ...attachment,
            organizationId: mail.organizationId,
            projectId: mail.projectId,
            mailId: mail.id,
            action: 'file',
            decidedBy: follow.userId,
            via: 'follow',
            followId: follow.id,
            decidedAt: now,
          })
          .returning()
        if (!filed) throw new Error(`the follow decision about attachment ${attachment.partId} was not written`)
        await tx
          .update(inboundMailParts)
          .set({ state: 'filing', decisionId: filed.id, claimExpiresAt: input.claimExpiresAt, lastFailure: null, updatedAt: now })
          .where(and(eq(inboundMailParts.id, attachment.partId), eq(inboundMailParts.state, 'waiting')))
        attachments.push(filed)
      }
      await tx.update(inboundMails).set({ updatedAt: now }).where(eq(inboundMails.id, mail.id))
      return { kind: 'written' as const, decision, attachments }
    })
  } catch (error) {
    if (error instanceof FollowDecisionRefused) return error.outcome
    throw error
  }
}
