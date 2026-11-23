import 'server-only'
import { ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AnnotationChanges, AnnotationRecord } from './repository'
import { auditSuppressedWake, wakesEnabled, type EnqueuedWake } from './wake'
import type { EndedDelegation, TakeBackAudit } from './take-back'
import type { AgentWakeTrigger } from './types'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentKind } from '@/lib/agent-kind'
import type { AnnotationActor } from './annotation-access'

export const delegationOfMark = (
  session: AuthorizedSession,
  documentId: string,
  mark: Pick<AnnotationRecord, 'id' | 'delegatedAt'>
): EndedDelegation | null =>
  mark.delegatedAt
    ? { organizationId: session.organizationId, documentId, annotationId: mark.id, delegatedAt: mark.delegatedAt }
    : null

export function delegationOf(
  session: AuthorizedSession,
  existing: AnnotationRecord,
  parsed: { delegateToPiloti?: boolean; status?: 'open' | 'resolved' | 'dismissed' },
  actor: AnnotationActor,
  now: Date
): AnnotationChanges['delegation'] | undefined {
  const cleared = { delegatedBy: null, delegatedAt: null } as const
  const closing = parsed.status === 'resolved' || parsed.status === 'dismissed'
  if (parsed.delegateToPiloti === undefined) return closing && existing.delegatedBy ? cleared : undefined
  if (isAgentKind(actor.kind)) throw new ForbiddenError(PRODUCT_NAME + ' cannot delegate a mark to itself.')
  if (!parsed.delegateToPiloti) return existing.delegatedBy ? cleared : undefined
  if (!wakesEnabled(session)) {
    throw new ForbiddenError('Delegating to ' + PRODUCT_NAME + ' is not switched on for this organization.', {
      reason: 'piloti-wakes-off',
    })
  }
  if ((parsed.status ?? existing.status) !== 'open') {
    throw new UnprocessableError('Only an open Anmerkung can be delegated to ' + PRODUCT_NAME + '.', { field: 'delegateToPiloti' })
  }
  return existing.delegatedBy ? undefined : { delegatedBy: session.userId, delegatedAt: now }
}

export const takeBackAudit = (
  session: AuthorizedSession,
  doc: { projectId: string | null },
  mark: { number: number },
  actor: AnnotationActor
): TakeBackAudit => ({
  userId: session.userId,
  email: session.email || null,
  piloti: isAgentKind(actor.kind),
  projectId: doc.projectId ?? null,
  markNumber: mark.number,
})

export function auditHeldWake(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  trigger: AgentWakeTrigger,
  wake: EnqueuedWake | null
): void {
  if (wake?.outcome !== 'suppressed') return
  auditSuppressedWake({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    annotationId,
    documentId,
    trigger,
    status: 'suppressed',
    reason: wake.reason,
    stage: 'enqueue',
  })
}
