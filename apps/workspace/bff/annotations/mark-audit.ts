import 'server-only'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AnnotationRecord } from './repository'

export type MarkDecision = 'taken_over' | 'dismissed'

export function auditMarkDecided(
  session: AuthorizedSession,
  doc: { id: string; projectId: string | null },
  mark: Pick<AnnotationRecord, 'id' | 'number' | 'kind' | 'createdBy'>,
  decision: MarkDecision
): void {
  recordAuditEventAfterCommit({
    action: 'piloti.mark.decided',
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'document_annotation',
    targetId: mark.id,
    alsoTargets: [
      { type: 'document', id: doc.id },
      { type: 'project', id: doc.projectId },
    ],
    metadata: { decision, markNumber: mark.number, markKind: mark.kind, onBehalfOf: mark.createdBy },
  })
}
