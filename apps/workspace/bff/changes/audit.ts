import 'server-only'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AgentChangeRow } from './repository'
import type { ChangeState, AgentChangeObject, AgentChangeOp } from './types'
import type { UndoPlan } from './undo'

const auditOp = (objectKind: AgentChangeObject, op: AgentChangeOp) =>
  objectKind === 'annotation_reply' ? 'reply' : op

const stringField = (state: ChangeState | null, field: string): string | null => {
  const value = state?.[field]
  return typeof value === 'string' ? value : null
}

export interface AuditedChange {
  objectKind: AgentChangeObject
  op: AgentChangeOp
  annotationId: string
  annotationNumber: number | null
  before: ChangeState | null
  after: ChangeState | null
  changeId: string | null
}

export interface AuditedTurn {
  organizationId: string
  documentId: string
  projectId: string | null
  conversationId: string
  answerMessageId: string | null
  onBehalfOf: string
  onBehalfOfEmail: string | null
}

export function auditAppliedChanges(turn: AuditedTurn, changes: readonly AuditedChange[]): void {
  for (const change of changes) {
    const state = change.after ?? change.before
    recordAuditEventAfterCommit({
      action: 'agent.change.applied',
      organizationId: turn.organizationId,
      actor: { userId: turn.onBehalfOf, email: turn.onBehalfOfEmail },
      targetType: 'document_annotation',
      targetId: change.annotationId,
      alsoTargets: [
        { type: 'document', id: turn.documentId },
        { type: 'project', id: turn.projectId },
        { type: 'conversation', id: turn.conversationId },
      ],
      metadata: {
        op: auditOp(change.objectKind, change.op),
        markNumber: change.annotationNumber,
        markKind: change.objectKind === 'annotation' ? stringField(state, 'kind') : null,
        status: change.objectKind === 'annotation' ? stringField(state, 'status') : null,
        fields: change.op === 'update' && change.after ? Object.keys(change.after).join(',') : null,
        messageId: turn.answerMessageId,
        changeId: change.changeId,
      },
    })
  }
}

export function auditUndoneChange(
  session: AuthorizedSession,
  row: AgentChangeRow,
  plan: UndoPlan,
  markNumber: number | null
): void {
  recordAuditEventAfterCommit({
    action: 'agent.change.undone',
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'document_annotation',
    targetId: row.annotationId,
    alsoTargets: [
      { type: 'document', id: row.documentId },
      { type: 'conversation', id: row.originConversationId },
    ],
    metadata: {
      op: auditOp(row.objectKind, row.op),
      inverse: plan.kind,
      markNumber,
      onBehalfOf: row.onBehalfOf,
      messageId: row.originMessageId,
      changeId: row.id,
    },
  })
}
