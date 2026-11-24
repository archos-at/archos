import 'server-only'
import { captureServer, type ServerEvent } from '@/lib/analytics/posthog-server'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AnnotationRecord } from './repository'
import { recordDecisionScore } from '@/lib/langfuse/decision-score'
import { publishToDocumentRoom } from '@/lib/realtime/document-channel'
import { auditMarkDecided } from './mark-audit'
import type { AnnotationChange } from './room-types'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentKind } from '@/lib/agent-kind'
import type { AnnotationActor } from './annotation-access'
import { bestEffort } from './annotation-notifications'

export function announce(
  session: AuthorizedSession,
  documentId: string,
  annotationIds: string[],
  change: AnnotationChange,
  actor: AnnotationActor
): void {
  void publishToDocumentRoom(documentId, {
    kind: 'annotations.changed',
    annotationIds,
    change,
    actor: {
      peerId: actor.peerId ?? null,
      userId: session.userId,
      name: isAgentKind(actor.kind) ? PRODUCT_NAME : (session.name ?? session.email),
      kind: actor.kind,
    },
  })
}

export function markEvent(
  session: AuthorizedSession,
  event: Extract<ServerEvent, 'annotation_created' | 'annotation_closed' | 'annotation_reopened' | 'annotation_carried'>,
  documentId: string,
  properties: Record<string, string | boolean>
): void {
  captureServer({
    event,
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: { document_id: documentId, ...properties },
  })
}

export function traceMove(
  session: AuthorizedSession,
  doc: { id: string; projectId: string | null },
  annotationId: string,
  existing: Pick<AnnotationRecord, 'authorKind' | 'status' | 'number' | 'kind' | 'createdBy'>,
  to: 'open' | 'resolved' | 'dismissed' | undefined
): void {
  const proposal = isAgentKind(existing.authorKind) && existing.status === 'proposed'
  if (!proposal || (to !== 'open' && to !== 'dismissed')) return
  auditMarkDecided(session, doc, { ...existing, id: annotationId }, to === 'open' ? 'taken_over' : 'dismissed')
  bestEffort('score the decision', () =>
    recordDecisionScore({
      subject: 'annotation',
      subjectId: annotationId,
      decision: to === 'open' ? 'accepted' : 'dismissed',
      decidedBy: session.userId,
      organizationId: session.organizationId,
    })
  )
}
