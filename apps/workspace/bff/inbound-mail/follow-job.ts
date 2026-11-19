import 'server-only'

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { captureServer } from '@/lib/analytics/posthog-server'
import { resolvePinnedRequesterSessionStrict } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isInboundMailEnabled } from '@/lib/authz/feature-flags'
import { requireFolderWrite } from '@/lib/authz/folder-access'
import type { InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { memberReader, SCREENED_ONLY } from '@/lib/documents/document-reader'
import {
  requesterOf,
  type InboundMailFollowPayload,
  type JobSliceResult,
} from '@/lib/jobs-queue/types'
import { RENDER_LEASE_RETRY_MS } from '@/lib/mail-thread/append'
import type { FollowRow } from '@/lib/mail-thread/follow-eligibility'
import { findThreadDocumentState, writeFollowDecision } from '@/lib/mail-thread/follow-repository'
import { endFollowBySystem } from '@/lib/mail-thread/follows'
import { findWritableThread } from '@/lib/mail-thread/write-repository'
import { isProjectClosedError } from '@/lib/projects/project-status'
import { inboundMailDomain } from './address'
import { announceAppended } from './announce'
import { auditDecisions } from './audit'
import { threadIsFull } from './candidates'
import { THREAD_DOCUMENT_TYPE } from './decision'
import { runInboundMailFiling } from './file-job'
import { findFilingWork, type FilingWork } from './filing-repository'
import { judgeFollow } from './follow-candidate'
import { findFiledMessages, findMailParts, type ThreadFollowContext } from './repository'
import { FILING_CLAIM_MS, hoursWaitingBucket } from './service'
import { scoreMailDecision } from './suggest-scores'

export const FOLLOW_WAIT_REASONS = [
  'not_waiting',
  'ineligible',
  'disabled',
  'project_closed',
  'document_held',
  'thread_full',
  'unreadable',
  'scan_not_clean',
  'already_filed',
  'follow_not_running',
  'follow_cap',
  'project_cap',
  'not_filed',
] as const
export type FollowWaitReason = (typeof FOLLOW_WAIT_REASONS)[number]

export type FollowOutcome =
  | { kind: 'appended' }
  | { kind: 'busy' }
  | { kind: 'waits'; reason: FollowWaitReason }
  | { kind: 'ended'; reason: 'access_lost' | 'document_gone' }

const waits = (reason: FollowWaitReason): FollowOutcome => ({ kind: 'waits', reason })

export async function runInboundMailFollow(
  organizationId: string,
  payload: InboundMailFollowPayload,
): Promise<JobSliceResult<InboundMailFollowPayload>> {
  const outcome = await followMail(organizationId, payload)
  console.debug(
    `[inbound-mail] follow of mail ${payload.mailId}: ${outcome.kind}${'reason' in outcome ? `:${outcome.reason}` : ''}`,
  )
  return outcome.kind === 'busy'
    ? { done: false, payload, notBefore: new Date(Date.now() + RENDER_LEASE_RETRY_MS) }
    : { done: true, payload }
}

export async function followMail(organizationId: string, payload: InboundMailFollowPayload): Promise<FollowOutcome> {
  const [work] = await findFilingWork(payload.projectId, [payload.mailId])
  if (!work || work.mail.organizationId !== organizationId) return waits('not_waiting')
  const text = work.parts.find((part) => part.kind === 'message')
  if (!text) return waits('not_waiting')
  if (text.state === 'filing') return resumeDecided(organizationId, payload, work, text)
  if (text.state !== 'waiting') return waits('not_waiting')

  const domain = inboundMailDomain()
  if (!domain) throw new Error('INBOUND_MAIL_DOMAIN is not set: a followed reply cannot be judged')
  const judged = await judgeFollow(work.mail, text.contentFindings.length, domain, null)
  if (!judged?.eligibility.eligible) return waits('ineligible')
  const { follow } = judged.eligibility
  const threadId = judged.thread.threadId

  const session = await followerSession(organizationId, follow.userId, payload)
  if (!session) return endFollow(follow, 'access_lost')
  const refused = await followerMayAppend(session, payload.projectId, threadId, follow)
  if (refused) return refused
  if (!work.mail.readStorageKey || text.riskFlags.includes('unreadable')) return waits('unreadable')
  if (work.mail.rawScanStatus !== 'clean') return waits('scan_not_clean')
  if (work.mail.messageId && (await findFiledMessages(payload.projectId, work.mail.messageId)).length > 0)
    return waits('already_filed')

  const now = new Date()
  const written = await writeFollowDecision({
    follow: { id: follow.id, userId: follow.userId, threadId },
    mail: {
      id: work.mail.id,
      organizationId,
      projectId: payload.projectId,
      receivedAt: new Date(work.mail.receivedAt),
    },
    partId: text.id,
    decision: { messageText: 'full', documentType: THREAD_DOCUMENT_TYPE },
    claimExpiresAt: new Date(now.getTime() + FILING_CLAIM_MS),
    now,
  })
  if (written.kind !== 'written') return waits(written.kind)
  await auditDecisions([written.decision])
  recordFollowDecision(session, work, text, judged.thread, now)
  return fileDecided(session, payload, written.decision.id, threadId)
}

async function resumeDecided(
  organizationId: string,
  payload: InboundMailFollowPayload,
  work: FilingWork,
  text: InboundMailPartRow,
): Promise<FollowOutcome> {
  const decision = work.decisions.get(text.id)
  if (decision?.via !== 'follow') return waits('not_waiting')
  const session = await followerSession(organizationId, decision.decidedBy, payload)
  if (!session) return waits('not_waiting')
  return fileDecided(session, payload, decision.id, decision.mailThreadId)
}

function followerSession(
  organizationId: string,
  userId: string,
  payload: InboundMailFollowPayload,
): Promise<AuthorizedSession | null> {
  const email = payload.requester.userId === userId ? payload.requester.email : null
  return resolvePinnedRequesterSessionStrict({ userId, email, organizationId })
}

async function followerMayAppend(
  session: AuthorizedSession,
  projectId: string,
  threadId: string,
  follow: FollowRow,
): Promise<FollowOutcome | null> {
  if (!isInboundMailEnabled(session)) return waits('disabled')
  const state = await findThreadDocumentState(projectId, threadId, memberReader(session.userId))
  if (state === 'gone') return endFollow(follow, 'document_gone')
  if (state === 'unseen') return waits('document_held')
  const thread = await findWritableThread(projectId, threadId, SCREENED_ONLY)
  if (!thread) return waits('document_held')
  try {
    await requireFolderWrite(session, projectId, [thread.document.folderId])
  } catch (error) {
    if (isProjectClosedError(error)) return waits('project_closed')
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return endFollow(follow, 'access_lost')
    throw error
  }
  if (threadIsFull(thread.thread)) return waits('thread_full')
  return null
}

async function endFollow(follow: FollowRow, reason: 'access_lost' | 'document_gone'): Promise<FollowOutcome> {
  await endFollowBySystem(follow, reason)
  return { kind: 'ended', reason }
}

async function fileDecided(
  session: AuthorizedSession,
  payload: InboundMailFollowPayload,
  decisionId: string,
  threadId: string | null,
): Promise<FollowOutcome> {
  const filed = await runInboundMailFiling(session, {
    projectId: payload.projectId,
    mailIds: [payload.mailId],
    decisionIds: [decisionId],
    requester: requesterOf(session),
  })
  if (!filed.done) return { kind: 'busy' }
  const text = (await findMailParts([payload.mailId])).find((part) => part.kind === 'message')
  if (text?.state !== 'filed') return waits('not_filed')
  if (threadId) {
    await announceAppended({
      organizationId: session.organizationId,
      projectId: payload.projectId,
      mailId: payload.mailId,
      threadId,
      followerUserId: session.userId,
    })
  }
  return { kind: 'appended' }
}

function recordFollowDecision(
  session: AuthorizedSession,
  work: FilingWork,
  text: InboundMailPartRow,
  thread: ThreadFollowContext,
  now: Date,
): void {
  const mail: InboundMailRow = work.mail
  const { threadId } = thread
  const suggestionFollowed = scoreMailDecision({
    organizationId: session.organizationId,
    decidedBy: session.userId,
    mail,
    parts: work.parts.filter((part) => part.kind === 'message'),
    decision: { parts: [], message: { partId: text.id, text: 'full', thread: { action: 'append', mailThreadId: threadId } } },
    via: 'follow',
    folderPathOf: () => null,
    threadOf: (id) => (id === threadId ? thread : null),
    decidedAt: now,
  })
  captureServer({
    event: 'inbound_mail_decided',
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: {
      files: 1,
      dismissed: 0,
      suggestion_followed: suggestionFollowed,
      thread_action: 'append',
      hours_waiting_bucket: hoursWaitingBucket(mail.receivedAt, now.getTime()),
      via: 'follow',
    },
  })
}
