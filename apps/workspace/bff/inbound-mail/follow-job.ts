import 'server-only'

import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
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
import {
  findThreadDocumentState,
  writeFollowDecision,
  type FollowAttachmentDecision,
} from '@/lib/mail-thread/follow-repository'
import { endFollowBySystem } from '@/lib/mail-thread/follows'
import { findWritableThread } from '@/lib/mail-thread/write-repository'
import { isProjectClosedError } from '@/lib/projects/project-status'
import { inboundMailDomain } from './address'
import { announceAppended } from './announce'
import { auditDecisions } from './audit'
import { threadIsFull } from './candidates'
import { planMailDecision, refusedPartOf, requireDecisionRights, THREAD_DOCUMENT_TYPE, type DecisionContext } from './decision'
import { runInboundMailFiling } from './file-job'
import { findFilingWork, type FilingWork } from './filing-repository'
import { judgeFollow } from './follow-candidate'
import { followAttachmentDecisions } from './follow-filing'
import type { InboundMailDecision } from './inbound-mail-wire'
import { mailViews } from './mail-views'
import { findFiledMessages, findMailParts, type ThreadFollowContext } from './repository'
import { withoutPart } from './sender-filing'
import { decisionContext, FILING_CLAIM_MS, hoursWaitingBucket } from './service'
import { scoreMailDecision } from './suggest-scores'
import { SUGGESTION_MAX_WAITS, SUGGESTION_WAIT_MS, suggestionPending } from './suggestion-wait'

export const FOLLOW_WAIT_REASONS = [
  'not_waiting',
  'ineligible',
  'disabled',
  'project_closed',
  'document_held',
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
  | { kind: 'appended'; attachments: number; left: number }
  | { kind: 'busy' }
  | { kind: 'later' }
  | { kind: 'waits'; reason: FollowWaitReason }
  | { kind: 'ended'; reason: 'access_lost' | 'document_gone' | 'thread_full' }

const waits = (reason: FollowWaitReason): FollowOutcome => ({ kind: 'waits', reason })

export async function runInboundMailFollow(
  organizationId: string,
  payload: InboundMailFollowPayload,
): Promise<JobSliceResult<InboundMailFollowPayload>> {
  const outcome = await followMail(organizationId, payload)
  console.debug(
    `[inbound-mail] follow of mail ${payload.mailId}: ${outcome.kind}${'reason' in outcome ? `:${outcome.reason}` : ''}`,
  )
  if (outcome.kind === 'later') {
    return { done: false, payload: { ...payload, waits: payload.waits + 1 }, notBefore: new Date(Date.now() + SUGGESTION_WAIT_MS) }
  }
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

  const chosen = await appendingFollower(organizationId, payload, work.mail, text)
  if ('kind' in chosen) return chosen
  const { follow, session, threadId, thread } = chosen
  if (!work.mail.readStorageKey || text.riskFlags.includes('unreadable')) return waits('unreadable')
  if (work.mail.rawScanStatus !== 'clean') return waits('scan_not_clean')
  if (work.mail.messageId && (await findFiledMessages(payload.projectId, work.mail.messageId)).length > 0)
    return waits('already_filed')
  if (payload.waits < SUGGESTION_MAX_WAITS && (await suggestionPending(organizationId, work.mail.id))) return { kind: 'later' }

  const attachments = await attachmentsToFile(session, work)
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
    attachments,
    claimExpiresAt: new Date(now.getTime() + FILING_CLAIM_MS),
    now,
  })
  if (written.kind !== 'written') return waits(written.kind)
  await auditDecisions([written.decision, ...written.attachments])
  const left = work.parts.filter((part) => part.kind === 'attachment' && part.state === 'waiting').length - written.attachments.length
  recordFollowDecision(session, work, text, thread, now, { attachments: written.attachments.length, left })
  return fileDecided(session, payload, [written.decision.id, ...written.attachments.map((decision) => decision.id)], threadId)
}

async function attachmentsToFile(session: AuthorizedSession, work: FilingWork): Promise<FollowAttachmentDecision[]> {
  const [view] = await mailViews(session, work.mail.projectId, [work.mail], false)
  const parts = view ? followAttachmentDecisions(view, work.parts) : []
  if (!view || parts.length === 0) return []
  let decision: InboundMailDecision | null = { mailId: work.mail.id, ifMatch: view.ifMatch, parts, message: null }
  const context: DecisionContext = {
    ...(await decisionContext(session, work.mail.projectId, { mails: [decision] }, [work.mail], work.parts)),
    actor: { decidedBy: session.userId, via: 'follow', proposalId: null },
  }
  while (decision) {
    try {
      const plan = planMailDecision(work.mail, work.parts, decision, context)
      await requireDecisionRights(session, work.mail.projectId, [plan])
      return plan.files.map((row) => ({
        id: row.id,
        partId: row.partId,
        folderId: row.folderId ?? null,
        folderPath: row.folderPath ?? null,
        fileName: row.fileName ?? null,
        targetDocumentId: row.targetDocumentId ?? null,
        documentType: row.documentType ?? null,
      }))
    } catch (error) {
      const partId = refusedPartOf(error)
      if (!partId) {
        if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof ForbiddenError) return []
        throw error
      }
      decision = withoutPart(decision, partId)
    }
  }
  return []
}

interface AppendingFollower {
  follow: FollowRow
  session: AuthorizedSession
  threadId: string
  thread: ThreadFollowContext
}

async function appendingFollower(
  organizationId: string,
  payload: InboundMailFollowPayload,
  mail: InboundMailRow,
  text: InboundMailPartRow,
): Promise<AppendingFollower | FollowOutcome> {
  const domain = inboundMailDomain()
  if (!domain) throw new Error('INBOUND_MAIL_DOMAIN is not set: a followed reply cannot be judged')
  const passedOver = new Set<string>()
  let lost: FollowOutcome | null = null
  for (;;) {
    const judged = await judgeFollow(mail, text.contentFindings.length, domain, null, new Date(), passedOver)
    if (!judged?.eligibility.eligible) return lost ?? waits('ineligible')
    const { follow } = judged.eligibility
    const threadId = judged.thread.threadId
    const session = await followerSession(organizationId, follow.userId, payload)
    const refused = session
      ? await followerMayAppend(session, payload.projectId, threadId, follow, judged.thread.follows)
      : await endFollow([follow], 'access_lost')
    if (!refused && session) return { follow, session, threadId, thread: judged.thread }
    if (refused?.kind !== 'ended' || refused.reason !== 'access_lost') return refused ?? waits('ineligible')
    passedOver.add(follow.id)
    lost = refused
  }
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
  const decided = [...work.decisions.values()].filter(
    (other) => other.via === 'follow' && other.followId === decision.followId && other.id !== decision.id,
  )
  return fileDecided(session, payload, [decision.id, ...decided.map((other) => other.id)], decision.mailThreadId)
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
  running: readonly FollowRow[],
): Promise<FollowOutcome | null> {
  if (!isInboundMailEnabled(session)) return waits('disabled')
  const state = await findThreadDocumentState(projectId, threadId, memberReader(session.userId))
  if (state === 'gone') return endFollow([follow], 'document_gone')
  if (state === 'unseen') return waits('document_held')
  const thread = await findWritableThread(projectId, threadId, SCREENED_ONLY)
  if (!thread) return waits('document_held')
  try {
    await requireFolderWrite(session, projectId, [thread.document.folderId])
  } catch (error) {
    if (isProjectClosedError(error)) return waits('project_closed')
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return endFollow([follow], 'access_lost')
    throw error
  }
  if (threadIsFull(thread.thread)) return endFollow(running, 'thread_full')
  return null
}

type FollowEndedBy = Extract<FollowOutcome, { kind: 'ended' }>['reason']

async function endFollow(follows: readonly FollowRow[], reason: FollowEndedBy): Promise<FollowOutcome> {
  for (const follow of follows) await endFollowBySystem(follow, reason)
  return { kind: 'ended', reason }
}

async function fileDecided(
  session: AuthorizedSession,
  payload: InboundMailFollowPayload,
  decisionIds: readonly string[],
  threadId: string | null,
): Promise<FollowOutcome> {
  const filed = await runInboundMailFiling(session, {
    projectId: payload.projectId,
    mailIds: [payload.mailId],
    decisionIds: [...decisionIds],
    requester: requesterOf(session),
  })
  if (!filed.done) return { kind: 'busy' }
  const parts = await findMailParts([payload.mailId])
  const text = parts.find((part) => part.kind === 'message')
  if (text?.state !== 'filed') return waits('not_filed')
  const ours = new Set(decisionIds)
  const attachments = parts.filter(
    (part) => part.kind === 'attachment' && part.state === 'filed' && part.decisionId !== null && ours.has(part.decisionId),
  ).length
  const left = parts.filter((part) => part.kind === 'attachment' && part.state === 'waiting').length
  if (threadId) {
    await announceAppended({
      organizationId: session.organizationId,
      projectId: payload.projectId,
      mailId: payload.mailId,
      threadId,
      followerUserId: session.userId,
      attachments,
    })
  }
  return { kind: 'appended', attachments, left }
}

function recordFollowDecision(
  session: AuthorizedSession,
  work: FilingWork,
  text: InboundMailPartRow,
  thread: ThreadFollowContext,
  now: Date,
  filed: { attachments: number; left: number },
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
      files: 1 + filed.attachments,
      left: filed.left,
      dismissed: 0,
      suggestion_followed: suggestionFollowed,
      thread_action: 'append',
      hours_waiting_bucket: hoursWaitingBucket(mail.receivedAt, now.getTime()),
      via: 'follow',
    },
  })
}
