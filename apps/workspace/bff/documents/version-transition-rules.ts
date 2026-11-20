import 'server-only'
import { ConflictError, ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import type { DocumentVersionOp, DocumentVersionTransition } from './lifecycle-types'
import { listReviewCandidates, resolveReviewers } from './reviewers'
import type { ReviewRoundWrite } from './version-repository'
import type { TransitionInput } from './version-effects'

export async function requireTransitionPermission(
  session: AuthorizedSession,
  document: Document,
  transition: DocumentVersionTransition,
): Promise<void> {
  if (!document.projectId) return
  await requireProjectAccess(session, document.projectId, transition.permission)
  if (transition.alsoRequires) {
    await requireProjectAccess(session, document.projectId, transition.alsoRequires)
  }
}

export function assertGuards(
  session: AuthorizedSession,
  version: DocumentVersion,
  transition: DocumentVersionTransition,
  input: TransitionInput,
): void {
  if (transition.actor === 'human' && input.actingHuman === false) {
    throw new ForbiddenError(`${transition.op} is a person's decision`, { op: transition.op })
  }
  if (transition.requires.comment && !input.comment?.trim()) {
    throw new UnprocessableError('This decision needs a comment', { op: transition.op })
  }
  if (
    transition.requires.ifMatch &&
    version.contentHash !== null &&
    input.ifMatch != null &&
    input.ifMatch !== version.contentHash
  ) {
    throw new ConflictError('The version changed since you read it', {
      op: transition.op,
      contentHash: version.contentHash,
    })
  }
}

export async function assertReviewGuards(
  session: AuthorizedSession,
  document: Document,
  version: DocumentVersion,
  transition: DocumentVersionTransition,
  input: TransitionInput,
): Promise<{ reviewers?: readonly string[]; selfReview: boolean }> {
  if (transition.requires.notSubmitter && version.submittedBy === session.userId) {
    if (version.submittedByActor === 'human') {
      const candidates = await listReviewCandidates(session, document)
      if (candidates.length > 0) {
        throw new ForbiddenError('The submitter cannot approve their own version', {
          op: transition.op,
        })
      }
      return { selfReview: true }
    }
  }

  if (!transition.requires.reviewer) return { selfReview: false }
  const resolved = await resolveReviewers(session, document, input.reviewerUserIds)
  return { reviewers: resolved.reviewers, selfReview: resolved.selfReview }
}

export function stampFor(
  transition: Pick<DocumentVersionTransition, 'to' | 'op'>,
  session: AuthorizedSession,
  input: TransitionInput,
  now: Date,
): Record<string, unknown> {
  const comment = input.comment?.trim() || null
  const { to } = transition
  if (transition.op === 'approve') {
    return {
      state: to,
      reviewedBy: session.userId,
      reviewedAt: now,
      approvedBy: session.userId,
      approvedAt: now,
      reviewComment: comment,
      ...(to === 'published' ? { publishedBy: session.userId, publishedAt: now } : {}),
    }
  }
  switch (to) {
    case 'in_review':
      return {
        state: to,
        submittedBy: session.userId,
        submittedByActor: input.actingHuman === false ? ('agent' as const) : ('human' as const),
        submittedAt: now,
      }
    case 'changes_requested':
    case 'rejected':
      return { state: to, reviewedBy: session.userId, reviewedAt: now, reviewComment: comment }
    case 'published':
      return transition.op === 'file'
        ? { state: to, origin: 'filing', publishedBy: session.userId, publishedAt: now }
        : { state: to, publishedBy: session.userId, publishedAt: now }
    case 'draft':
      return { state: to, reviewComment: null, reviewedBy: null, reviewedAt: null }
    default:
      return { state: to }
  }
}

export function reviewRoundFor(
  op: DocumentVersionOp,
  session: AuthorizedSession,
  input: TransitionInput,
): ReviewRoundWrite | undefined {
  const comment = input.comment?.trim() || null
  switch (op) {
    case 'submit':
      return {
        kind: 'open',
        requestedBy: session.userId,
        requestedByActor: input.actingHuman === false ? 'agent' : 'human',
        reviewerUserIds: input.reviewerUserIds ?? [],
      }
    case 'approve':
      return { kind: 'decide', outcome: 'approved', decidedBy: session.userId, comment }
    case 'request_changes':
      return { kind: 'decide', outcome: 'changes_requested', decidedBy: session.userId, comment }
    case 'reject':
      return { kind: 'decide', outcome: 'rejected', decidedBy: session.userId, comment }
    default:
      return undefined
  }
}
