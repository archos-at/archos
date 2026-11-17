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

export const SECOND_REVIEW_STATUSES: readonly ChangeRequestStatus[] = ['approved', 'published', 'rolled_back']

export interface DecisionOutcome {
  status: ChangeRequestStatus
  awaiting: ApprovalRole[]
  approval: ChangeRequestApproval
  secondReview: SecondReviewState | null
  secondReviewDue: ApprovalRole[]
}

export type Decided = DecisionOutcome & {
  alone: string[]
  withdrawn: number
  secondReviewGiven?: 'confirmed' | 'disputed'
}

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

async function rejectRequest(tx: Tx, request: ChangeRequestRow, actor: Actor): Promise<Decided> {
  const disputed = request.status === 'approved' && request.secondReview === 'disputed'
  if (!['draft', 'submitted'].includes(request.status) && !disputed) {
    throw new ConflictError(`The change request is ${request.status}; only a draft, a submitted one, or an approved one whose second review disputed it is rejected.`)
  }
  const withdrawn = disputed ? await retractPreview(tx, request.id, actor, 'Withdrawn: the second review disputed the approval') : 0
  await setChangeRequestStatus(tx, request.id, 'rejected', 'decidedAt')
  if (request.secondReview === 'due') await voidSecondReview(tx, request.id, actor.by)
  const secondReview = request.secondReview === 'due' ? 'void' : request.secondReview
  return { status: 'rejected', awaiting: [], approval: request.approval, secondReview, secondReviewDue: [], alone: [], withdrawn }
}

async function approveSubmitted(tx: Tx, request: ChangeRequestRow, input: Input, actor: Actor): Promise<Decided> {
  if (request.status !== 'submitted') throw new ConflictError(`The change request is ${request.status}; only a submitted one is approved.`)
  const revisions = await reviewedRevisions(tx, request.id)
  const authored = (await requestAuthors(tx, request.id)).has(actor.by)
  if (authored && !input.override) throw new ConflictError('You wrote a revision in this change request, so another person approves it (four eyes).')
  if (!authored && input.override) {
    throw new ConflictError('You wrote no revision in this change request, so there is nothing to override; approve it without the override.')
  }
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
  const marked = (await lockChangeRequest(tx, request.id)) ?? request
  const marks = { approval: marked.approval, secondReview: marked.secondReview }
  const alone = input.override ? revisions.map((revision) => revision.revisionId) : []
  const awaiting = await awaitedApprovalRoles(tx, request.id)
  if (awaiting.length === 0) await setChangeRequestStatus(tx, request.id, 'approved', 'decidedAt')
  return { status: awaiting.length > 0 ? 'submitted' : 'approved', awaiting, ...marks, secondReviewDue: [], alone, withdrawn: 0 }
}

async function giveSecondReview(tx: Tx, request: ChangeRequestRow, input: Input, actor: Actor): Promise<Decided> {
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
    const action = outcome.secondReviewGiven === 'confirmed' ? 'platform.knowledge.second_review_confirmed' : 'platform.knowledge.second_review_disputed'
    return { action, targetId: requestId, metadata: { role, decisionSource, status: outcome.status, state: outcome.secondReview ?? '' } }
  }
  if (body.override) {
    return {
      action: 'platform.knowledge.change_request_approved_alone',
      targetId: requestId,
      metadata: {
        role,
        decisionSource,
        reason: body.override.reason,
        revisions: outcome.alone.join(',').slice(0, 500),
        revisionCount: outcome.alone.length,
        awaiting: outcome.awaiting.join(','),
      },
    }
  }
  if (body.decision === 'reject') {
    return { action: 'platform.knowledge.change_request_rejected', targetId: requestId, metadata: { role, decisionSource, awaiting: '', withdrawn: outcome.withdrawn } }
  }
  return { action: 'platform.knowledge.change_request_approved', targetId: requestId, metadata: { role, decisionSource, awaiting: outcome.awaiting.join(',') } }
}
