/**
 * A decision on a platform change request, inside its transaction (ADR-0165,
 * ADR-0176): approve or reject a submitted one, approve one alone, reject one
 * whose second review disputed it, and give that second review. The service
 * (`./service.ts`) has checked the platform permission, the role's permission
 * and the person's own yes before it calls; the triggers of migrations 0205,
 * 0208, 0209 and 0214 hold every rule here again, whatever path reaches them.
 */

import 'server-only'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import type {
  ApprovalRole,
  ChangeRequestApproval,
  ChangeRequestStatus,
  PersonDecisionSource,
  ReleaseDecisionSource,
  SecondReviewState,
} from '@/lib/base-knowledge/wire/vocab'
import type { Tx } from '../store/repository'
import { retractPreview } from './release'
import { singleOperator } from './single-operator'
import {
  awaitedApprovalRoles,
  insertApproval,
  insertSecondReview,
  lockChangeRequest,
  requestAuthors,
  reviewedRevisions,
  secondReviewRoles,
  setChangeRequestStatus,
  voidSecondReview,
  type ChangeRequestRow,
} from './store'
import type { ApprovalBody } from './wire'

/**
 * Where a due second review is given: once the request was approved. A submitted one still waits for a role
 * (counsel, a privacy reviewer) and is decided as before; a rejected one reached no office, so it owes nothing.
 */
export const SECOND_REVIEW_STATUSES: readonly ChangeRequestStatus[] = ['approved', 'published', 'rolled_back']

/** What a decision answers: where the request stands, how it was approved, and the roles still owed a second review. */
export interface DecisionOutcome {
  status: ChangeRequestStatus
  awaiting: ApprovalRole[]
  approval: ChangeRequestApproval
  secondReview: SecondReviewState | null
  secondReviewDue: ApprovalRole[]
}

export type Decided = DecisionOutcome & {
  /** The revisions an override approved alone, for its audit event. */
  alone: string[]
  /** Previews a disputed request withdrew when it was rejected. */
  withdrawn: number
  /** Set when this decision was a second review, in the role the decider holds. */
  secondReviewGiven?: 'confirmed' | 'disputed'
}

/** Who decides, and how: a person's yes here, or a decision carried from the deployment that released it (ADR-0181). */
type Actor = { by: string; decisionSource: ReleaseDecisionSource }
type Input = Omit<ApprovalBody, 'role'> & { role: ApprovalRole }

const notAccepted = (revisions: Awaited<ReturnType<typeof reviewedRevisions>>, blocks: (decision: string | null) => boolean) =>
  revisions.flatMap((revision) => revision.claims.filter((claim) => blocks(claim.decision)).map((claim) => `${revision.recordId}.${claim.path}`))

export async function decideInTransaction(tx: Tx, requestId: string, input: Input, actor: Actor): Promise<Decided> {
  const request = await lockChangeRequest(tx, requestId)
  if (!request) throw new NotFoundError('No change request with this id; list them first.')
  const decided =
    request.secondReview === 'due' && SECOND_REVIEW_STATUSES.includes(request.status)
      ? await giveSecondReview(tx, request, input, actor)
      : input.decision === 'reject'
        ? await rejectRequest(tx, request, actor)
        : await approveSubmitted(tx, request, input, actor)
  const due = decided.approval === 'single' ? (await secondReviewRoles(tx, requestId)).filter((role) => role.state === 'due') : []
  return { ...decided, secondReviewDue: decided.secondReview === 'due' ? due.map((role) => role.role) : [] }
}

/**
 * Reject a draft or a submitted request, or an approved one whose second
 * review disputed it: its preview is withdrawn first, so nothing of it stays
 * on any channel. A review owed by a request rejected before approval is void.
 */
async function rejectRequest(tx: Tx, request: ChangeRequestRow, actor: Actor): Promise<Decided> {
  const disputed = request.status === 'approved' && request.secondReview === 'disputed'
  // A draft may be rejected too: a monitor's request a reviewer finds nothing to do for is closed that way (ADR-0174).
  if (!['draft', 'submitted'].includes(request.status) && !disputed) {
    throw new ConflictError(`The change request is ${request.status}; only a draft, a submitted one, or an approved one whose second review disputed it is rejected.`)
  }
  const withdrawn = disputed ? await retractPreview(tx, request.id, actor, 'Withdrawn: the second review disputed the approval') : 0
  await setChangeRequestStatus(tx, request.id, 'rejected', 'decidedAt')
  if (request.secondReview === 'due') await voidSecondReview(tx, request.id, actor.by)
  const secondReview = request.secondReview === 'due' ? 'void' : request.secondReview
  return { status: 'rejected', awaiting: [], approval: request.approval, secondReview, secondReviewDue: [], alone: [], withdrawn }
}

/**
 * Approve a submitted request, in a role. With `override` its author approves
 * alone: a claim nobody reviewed waits for the second review (on a deployment set
 * to one operator alone, where none is due, every claim must be accepted first), one somebody
 * marked edited or rejected still blocks, and the trigger marks the request
 * single with a second review due (migration 0214); on a deployment set to one
 * operator alone it marks it single with none due (migration 0233).
 */
async function approveSubmitted(tx: Tx, request: ChangeRequestRow, input: Input, actor: Actor): Promise<Decided> {
  if (request.status !== 'submitted') throw new ConflictError(`The change request is ${request.status}; only a submitted one is approved.`)
  const revisions = await reviewedRevisions(tx, request.id)
  // Four eyes first: an author's plain approve names the rule, not the claims they may not review (the trigger holds it too).
  const authored = (await requestAuthors(tx, request.id)).has(actor.by)
  if (authored && !input.override) throw new ConflictError('You wrote a revision in this change request, so another person approves it (four eyes).')
  if (!authored && input.override) {
    throw new ConflictError('You wrote no revision in this change request, so there is nothing to override; approve it without the override.')
  }
  // A claim nobody reviewed may wait for the second review; one operator alone owes none, so it reviews every claim.
  const waivesUnreviewed = Boolean(input.override) && !singleOperator()
  const open = notAccepted(revisions, (decision) => (waivesUnreviewed ? decision !== null && decision !== 'accepted' : decision !== 'accepted'))
  if (open.length > 0) throw new ConflictError(`${open.length} claim(s) are not accepted (${open.slice(0, 5).join(', ')}); review them first.`)
  await insertApproval(tx, {
    changeRequestId: request.id,
    approver: actor.by,
    role: input.role,
    decisionSource: actor.decisionSource,
    ...(input.override ? { overrideReason: input.override.reason } : {}),
  })
  // The trigger marked an override `single`, with a second review due unless one operator works alone (migration 0233).
  const marked = (await lockChangeRequest(tx, request.id)) ?? request
  const marks = { approval: marked.approval, secondReview: marked.secondReview }
  const alone = input.override ? revisions.map((revision) => revision.revisionId) : []
  // Counsel for an advice policy, a privacy reviewer for a site-keyed source (ADR-0174): until each has said
  // yes the request stays submitted, and the publish trigger refuses it whatever path reaches it.
  const awaiting = await awaitedApprovalRoles(tx, request.id)
  if (awaiting.length === 0) await setChangeRequestStatus(tx, request.id, 'approved', 'decidedAt')
  return { status: awaiting.length > 0 ? 'submitted' : 'approved', awaiting, ...marks, secondReviewDue: [], alone, withdrawn: 0 }
}

/**
 * Another person's second review of a request approved alone, in one role
 * approved alone that they hold (ADR-0176): approve confirms it once every
 * claim is accepted, reject disputes it. The request is confirmed once every
 * such role is, and disputed by one dispute; a dispute changes nothing offices
 * read, and what follows (reject, or rollback) is the person's next decision.
 */
async function giveSecondReview(tx: Tx, request: ChangeRequestRow, input: Input, actor: Actor): Promise<Decided> {
  // A second review is another person's look here; nothing carries one.
  if (actor.decisionSource === 'carried') throw new ConflictError('A second review is given by a person on this deployment; it is never carried.')
  const decisionSource = actor.decisionSource
  if (input.override) throw new ConflictError('The second review of this change request is due; another person gives it, without an override.')
  if ((await requestAuthors(tx, request.id)).has(actor.by)) {
    throw new ConflictError('You wrote a revision in this change request, so another person gives its second review (four eyes).')
  }
  const due = (await secondReviewRoles(tx, request.id)).filter((role) => role.state === 'due').map((role) => role.role)
  if (!due.includes(input.role)) {
    throw new ConflictError(`No second review is due in the ${input.role} role; it is due in ${due.join(', ')}.`)
  }
  if (input.decision === 'approve') {
    const open = notAccepted(await reviewedRevisions(tx, request.id), (decision) => decision !== 'accepted')
    if (open.length > 0) throw new ConflictError(`${open.length} claim(s) are not accepted (${open.slice(0, 5).join(', ')}); review them before confirming.`)
  }
  const given = input.decision === 'approve' ? 'confirmed' : 'disputed'
  await insertSecondReview(tx, { changeRequestId: request.id, role: input.role, decision: given, reviewer: actor.by, decisionSource })
  // The trigger closed the request's review when this was the last owed role, or a dispute.
  const after = await lockChangeRequest(tx, request.id)
  const secondReview = after?.secondReview ?? request.secondReview
  return { status: request.status, awaiting: [], approval: request.approval, secondReview, secondReviewDue: [], alone: [], withdrawn: 0, secondReviewGiven: given }
}

export type KnowledgeAuditAction =
  | 'platform.knowledge.change_request_approved'
  | 'platform.knowledge.change_request_rejected'
  | 'platform.knowledge.change_request_approved_alone'
  | 'platform.knowledge.second_review_confirmed'
  | 'platform.knowledge.second_review_disputed'
  | 'platform.knowledge.published'
  | 'platform.knowledge.rolled_back'

/** A decision on a change request, in the platform organization's trail. */
export async function audit(
  session: UserSession,
  { action, targetId, metadata }: { action: KnowledgeAuditAction; targetId: string; metadata: Record<string, string | number | boolean> },
) {
  const organizationId = await getPlatformOrganizationId()
  if (!organizationId) return
  await recordAuditEvent({
    organizationId,
    actor: { userId: session.userId, email: session.email },
    action,
    targetType: 'knowledge_change_request',
    targetId,
    metadata,
  })
}

export function auditOfDecision(
  requestId: string,
  body: ApprovalBody,
  role: ApprovalRole,
  decisionSource: PersonDecisionSource,
  outcome: Decided,
): { action: KnowledgeAuditAction; targetId: string; metadata: Record<string, string | number | boolean> } {
  if (outcome.secondReviewGiven) {
    // One event per role reviewed; `state` is the request's review after it (due while another role is owed).
    const action = outcome.secondReviewGiven === 'confirmed' ? 'platform.knowledge.second_review_confirmed' : 'platform.knowledge.second_review_disputed'
    return { action, targetId: requestId, metadata: { role, decisionSource, status: outcome.status, state: outcome.secondReview ?? '' } }
  }
  if (body.override) {
    // One event per override: who and when are the event's own, the reason and what was approved alone its metadata.
    return {
      action: 'platform.knowledge.change_request_approved_alone',
      targetId: requestId,
      metadata: {
        role,
        decisionSource,
        reason: body.override.reason,
        // Cut at 500 characters like every list in the trail; the count says when, and the approval row keeps the request.
        revisions: outcome.alone.join(',').slice(0, 500),
        revisionCount: outcome.alone.length,
        awaiting: outcome.awaiting.join(','),
      },
    }
  }
  if (body.decision === 'reject') {
    return { action: 'platform.knowledge.change_request_rejected', targetId: requestId, metadata: { role, decisionSource, awaiting: '', withdrawn: outcome.withdrawn } }
  }
  // Every yes is audited, also one that leaves the request waiting for another role.
  return { action: 'platform.knowledge.change_request_approved', targetId: requestId, metadata: { role, decisionSource, awaiting: outcome.awaiting.join(',') } }
}
