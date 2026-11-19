import 'server-only'

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import { SYSTEM_ACTORS } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds, requireFolderWrite } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getDb } from '@/lib/db'
import type { MailThreadFollowRow } from '@/lib/db/schema/mail-thread'
import { memberReader } from '@/lib/documents/document-reader'
import { managesProject, requireInboundMailEnabled, requireMailReviewer } from '@/lib/inbound-mail/access'
import { announceFollowEnded, announceFollowsEnded, settleFollowExpiring } from '@/lib/inbound-mail/announce'
import { auditFollowsEnded } from '@/lib/inbound-mail/audit'
import { endProjectFollows } from '@/lib/inbound-mail/repository'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { endFollow, findRunningFollow, renewFollow, startFollow, type FollowEnd } from './follow-repository'
import type {
  MailThreadFollowBody,
  MailThreadFollowResultView,
  MailThreadFollowView,
  MailThreadUnfollowQuery,
  MailThreadUnfollowResultView,
} from './mail-thread-wire'
import { MAIL_THREAD_FOLLOW_DEFAULT_DAYS } from './mail-thread-vocabulary'
import { findVisibleThread } from './repository'
import { findWritableThread } from './write-repository'

const DAY_MS = 24 * 60 * 60 * 1000

export function followView(follow: MailThreadFollowRow): MailThreadFollowView {
  return {
    id: follow.id,
    userId: follow.userId,
    createdAt: new Date(follow.createdAt).toISOString(),
    expiresAt: new Date(follow.expiresAt).toISOString(),
    renewedAt: follow.renewedAt === null ? null : new Date(follow.renewedAt).toISOString(),
    dailyCap: follow.dailyCap,
  }
}

const notFound = () => new NotFoundError('Mail thread not found')

export async function followMailThread(
  session: AuthorizedSession,
  projectId: string,
  threadId: string,
  body: MailThreadFollowBody,
): Promise<MailThreadFollowResultView> {
  await requireMailReviewer(session, projectId)
  const hidden = await getHiddenFolderIds(session, projectId)
  if (!(await findVisibleThread(projectId, threadId, hidden))) throw notFound()
  const thread = await findWritableThread(projectId, threadId, memberReader(session.userId))
  if (!thread) throw notFound()
  await requireFolderWrite(session, projectId, [thread.document.folderId])

  const days = body.days ?? MAIL_THREAD_FOLLOW_DEFAULT_DAYS
  const now = new Date()
  const until = new Date(now.getTime() + days * DAY_MS)
  const { follow, renewed } = await startOrRenew(session, projectId, threadId, until, now)

  recordFollowStarted(session, follow, { days, renewed })
  publishProjectChanged(session.organizationId, projectId)
  return { follow: followView(follow), renewed }
}

async function startOrRenew(
  session: AuthorizedSession,
  projectId: string,
  threadId: string,
  until: Date,
  now: Date,
): Promise<{ follow: MailThreadFollowRow; renewed: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const running = await findRunningFollow(threadId, session.userId)
    if (running && new Date(running.expiresAt).getTime() > now.getTime()) {
      const follow = await renewFollow(running.id, until, now)
      if (!follow) continue
      await settleFollowExpiring(session.organizationId, [follow.id])
      return { follow, renewed: true }
    }
    if (running) await endFollowBySystem(running, 'expired', now)
    const follow = await startFollow({
      organizationId: session.organizationId,
      projectId,
      threadId,
      userId: session.userId,
      createdAt: now,
      expiresAt: until,
    })
    if (follow) return { follow, renewed: false }
  }
  throw new Error(`could not start or renew the follow of mail thread ${threadId}`)
}

export async function unfollowMailThread(
  session: AuthorizedSession,
  projectId: string,
  threadId: string,
  query: MailThreadUnfollowQuery,
): Promise<MailThreadUnfollowResultView> {
  requireInboundMailEnabled(session)
  await requireProjectAccess(session, projectId, 'project:view')
  const followerId = query.userId ?? session.userId
  const own = followerId === session.userId
  if (!own && !(await managesProject(session, projectId))) {
    throw new ForbiddenError("Ending another person's follow needs project:manage")
  }

  const running = await findRunningFollow(threadId, followerId)
  if (!running || running.projectId !== projectId) {
    if (!(await findVisibleThread(projectId, threadId, await getHiddenFolderIds(session, projectId)))) throw notFound()
    return { endedFollowId: null }
  }
  const end: FollowEnd = own
    ? { reason: 'unfollowed', endedBy: session.userId }
    : { reason: 'revoked_by_manager', endedBy: session.userId }
  const ended = await endFollow(running.id, end)
  if (!ended) return { endedFollowId: null }
  recordFollowEnded(session.organizationId, { userId: session.userId, email: session.email || null }, ended)
  await settleFollowExpiring(session.organizationId, [ended.id])
  await announceFollowEnded(endedNotice(ended, end.reason, session.userId))
  publishProjectChanged(session.organizationId, projectId)
  return { endedFollowId: ended.id }
}

export async function endFollowBySystem(
  follow: Pick<MailThreadFollowRow, 'id'>,
  reason: Extract<FollowEnd['reason'], 'access_lost' | 'document_gone' | 'expired' | 'project_closed' | 'thread_full'>,
  now: Date = new Date(),
): Promise<boolean> {
  const ended = await endFollow(follow.id, { reason, endedBy: null }, now)
  if (!ended) return false
  recordFollowEnded(ended.organizationId, { userId: SYSTEM_ACTORS.inboundMail, email: null }, ended)
  await settleFollowExpiring(ended.organizationId, [ended.id])
  await announceFollowEnded(endedNotice(ended, reason, null))
  publishProjectChanged(ended.organizationId, ended.projectId)
  return true
}

function endedNotice(follow: MailThreadFollowRow, reason: FollowEnd['reason'], endedBy: string | null) {
  return { organizationId: follow.organizationId, projectId: follow.projectId, followId: follow.id, followerUserId: follow.userId, reason, endedBy }
}

export async function endFollowsOnProjectClose(session: AuthorizedSession, projectId: string, at: Date = new Date()): Promise<number> {
  const ended = await endProjectFollows(getDb(), projectId, { endedBy: session.userId, reason: 'project_closed' }, at)
  if (ended.length === 0) return 0
  auditFollowsEnded(session.organizationId, projectId, session.userId, ended, 'project_closed')
  ended.forEach(() =>
    captureServer({
      event: 'mail_thread_followed',
      distinctId: session.userId,
      organizationId: session.organizationId,
      properties: { action: 'end', reason: 'project_closed' },
    })
  )
  await settleFollowExpiring(session.organizationId, ended.map((follow) => follow.id))
  await announceFollowsEnded(session.organizationId, projectId, ended, 'project_closed', session.userId)
  publishProjectChanged(session.organizationId, projectId)
  return ended.length
}

function recordFollowStarted(
  session: AuthorizedSession,
  follow: MailThreadFollowRow,
  started: { days: number; renewed: boolean },
): void {
  recordAuditEventAfterCommit({
    action: 'mail_thread.follow_started',
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'mail_thread',
    targetId: follow.threadId,
    alsoTargets: [{ type: 'project', id: follow.projectId }],
    metadata: { projectId: follow.projectId, followId: follow.id, days: started.days, renewed: started.renewed },
  })
  captureServer({
    event: 'mail_thread_followed',
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: { action: started.renewed ? 'renew' : 'start', days: started.days },
  })
}

function recordFollowEnded(
  organizationId: string,
  actor: { userId: string; email: string | null },
  follow: MailThreadFollowRow,
): void {
  const reason = follow.endedReason ?? 'unfollowed'
  recordAuditEventAfterCommit({
    action: 'mail_thread.follow_ended',
    organizationId,
    actor,
    targetType: 'mail_thread',
    targetId: follow.threadId,
    alsoTargets: [{ type: 'project', id: follow.projectId }],
    metadata: { projectId: follow.projectId, followId: follow.id, reason, followerUserId: follow.userId },
    idempotencyKey: `mail_thread.follow_ended:${follow.id}`,
  })
  captureServer({
    event: 'mail_thread_followed',
    distinctId: follow.endedBy,
    organizationId,
    properties: { action: 'end', reason },
  })
}
