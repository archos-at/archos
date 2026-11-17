import 'server-only'
import { ApiError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { createAnnotation, deleteAnnotation, deleteReply, listAnnotations, updateAnnotation } from '@/lib/annotations/service'
import type { AnnotationView } from '@/lib/annotations/types'
import type { AuthorizedSession } from '@/lib/auth/types'
import { recordDecisionScore } from '@/lib/langfuse/decision-score'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import {
  claimUndo,
  findAgentChange,
  insertAgentChanges,
  listTurnChangeRows,
  releaseUndo,
  type NewAgentChange,
  type AgentChangeRow,
} from './repository'
import { auditAppliedChanges, auditUndoneChange } from './audit'
import { planUndo, type UndoPlan } from './undo'
import type { ChangeState, AgentChangeObject, AgentChangeOp, AgentChangeView, UndoRefusal } from './types'
import { PRODUCT_NAME } from '@/lib/brand'

export interface ChangeOrigin {
  organizationId: string
  documentId: string
  conversationId: string
  answerMessageId: string | null
  onBehalfOf: string
  onBehalfOfEmail?: string | null
  projectId?: string | null
}

export interface AppliedChange {
  objectKind: AgentChangeObject
  objectId: string
  annotationId: string
  op: AgentChangeOp
  before: ChangeState | null
  after: ChangeState | null
  annotationNumber?: number | null
}

let warnedWithoutAnswer = false

export async function recordAgentChanges(origin: ChangeOrigin, changes: readonly AppliedChange[]): Promise<void> {
  if (changes.length === 0) return
  const rows = await insertLedgerRows(origin, changes)
  auditAppliedChanges(
    {
      organizationId: origin.organizationId,
      documentId: origin.documentId,
      projectId: origin.projectId ?? null,
      conversationId: origin.conversationId,
      answerMessageId: origin.answerMessageId,
      onBehalfOf: origin.onBehalfOf,
      onBehalfOfEmail: origin.onBehalfOfEmail ?? null,
    },
    changes.map((change) => ({
      objectKind: change.objectKind,
      op: change.op,
      annotationId: change.annotationId,
      annotationNumber: change.annotationNumber ?? null,
      before: change.before,
      after: change.after,
      changeId: rows.find((row) => row.objectId === change.objectId)?.id ?? null,
    }))
  )
}

async function insertLedgerRows(origin: ChangeOrigin, changes: readonly AppliedChange[]): Promise<AgentChangeRow[]> {
  if (!origin.answerMessageId) {
    if (!warnedWithoutAnswer) {
      warnedWithoutAnswer = true
      console.warn('[changes] a write op arrived without answerMessageId; an agent older than ADR-0109 records nothing')
    }
    return []
  }
  const rows: NewAgentChange[] = changes.map((change) => ({
    organizationId: origin.organizationId,
    documentId: origin.documentId,
    annotationId: change.annotationId,
    objectKind: change.objectKind,
    objectId: change.objectId,
    op: change.op,
    before: change.before,
    after: change.after,
    originConversationId: origin.conversationId,
    originMessageId: origin.answerMessageId as string,
    onBehalfOf: origin.onBehalfOf,
  }))
  try {
    return await insertAgentChanges(origin.organizationId, rows)
  } catch (error) {
    console.error('[changes] could not record what the turn applied', origin.answerMessageId, error)
    return []
  }
}

interface DocumentMarks {
  marks: ReadonlyMap<string, AnnotationView>
  canAnnotate: boolean
}

async function readDocumentMarks(session: AuthorizedSession, documentId: string): Promise<DocumentMarks | null> {
  try {
    const { annotations, canAnnotate } = await listAnnotations(session, documentId)
    return { marks: new Map(annotations.map((mark) => [mark.id, mark])), canAnnotate }
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null
    throw error
  }
}

type Names = ReadonlyMap<string, { name: string }>

const nameOf = (names: Names, userId: string | null) => (userId ? (names.get(userId)?.name ?? null) : null)

function mayRun(plan: UndoPlan, marks: DocumentMarks, current: AnnotationView | undefined, userId: string): boolean {
  switch (plan.kind) {
    case 'recreate':
      return marks.canAnnotate
    case 'delete':
      return Boolean(current?.canDelete)
    case 'delete-reply':
      return Boolean(current?.canEdit && current.replies.some((r) => r.id === plan.replyId && r.createdBy === userId))
    default:
      return Boolean(current?.canEdit)
  }
}

function toView(row: AgentChangeRow, marks: DocumentMarks, names: Names, userId: string): AgentChangeView {
  const current = marks.marks.get(row.annotationId)
  const outcome = row.undoneAt ? null : planUndo(row, current)
  return {
    id: row.id,
    documentId: row.documentId,
    annotationId: row.annotationId,
    annotationNumber: current?.number ?? null,
    objectKind: row.objectKind,
    objectId: row.objectId,
    op: row.op,
    before: row.before ?? null,
    after: row.after ?? null,
    onBehalfOf: row.onBehalfOf,
    onBehalfOfName: nameOf(names, row.onBehalfOf),
    createdAt: row.createdAt.toISOString(),
    undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
    undoneBy: row.undoneBy,
    undoneByName: nameOf(names, row.undoneBy),
    canUndo: outcome !== null && 'plan' in outcome && mayRun(outcome.plan, marks, current, userId),
  }
}

async function viewsFor(session: AuthorizedSession, rows: readonly AgentChangeRow[]): Promise<AgentChangeView[]> {
  const documents = new Map<string, DocumentMarks | null>()
  for (const documentId of new Set(rows.map((row) => row.documentId))) {
    documents.set(documentId, await readDocumentMarks(session, documentId))
  }
  const names: Names = await loadOrganizationDirectory(session.organizationId).catch(() => new Map())
  return rows.flatMap((row) => {
    const marks = documents.get(row.documentId)
    return marks ? [toView(row, marks, names, session.userId)] : []
  })
}

export async function listTurnChanges(
  session: AuthorizedSession,
  conversationId: string,
  messageId: string
): Promise<AgentChangeView[]> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  const rows = await listTurnChangeRows(session.organizationId, conversationId, messageId)
  return viewsFor(session, rows)
}

const REFUSAL_MESSAGES: Record<UndoRefusal, string> = {
  'moved-on': 'This is no longer as ' + PRODUCT_NAME + ' left it, so undoing it would undo somebody else’s change.',
  'already-undone': 'Somebody undid this already.',
}

export class UndoRefusedError extends ConflictError {
  constructor(
    readonly refusal: UndoRefusal,
    message = REFUSAL_MESSAGES[refusal]
  ) {
    super(message, { reason: refusal })
  }
}

async function loadReadable(
  session: AuthorizedSession,
  id: string
): Promise<{ row: AgentChangeRow; marks: DocumentMarks }> {
  const row = await findAgentChange(session.organizationId, id)
  if (!row) throw new NotFoundError()
  await requireResourceAccess(session, 'conversation', row.originConversationId, 'viewer')
  const marks = await readDocumentMarks(session, row.documentId)
  if (!marks) throw new NotFoundError()
  return { row, marks }
}

async function runPlan(session: AuthorizedSession, row: AgentChangeRow, plan: UndoPlan): Promise<void> {
  switch (plan.kind) {
    case 'dismiss':
    case 'revert':
      await updateAnnotation(session, row.documentId, row.annotationId, plan.request)
      return
    case 'recreate': {
      const { annotation } = await createAnnotation(session, row.documentId, plan.mark)
      if (plan.status === 'resolved') {
        await updateAnnotation(session, row.documentId, annotation.id, { status: 'resolved', expectedStatus: 'open' })
      }
      return
    }
    case 'delete':
      await deleteAnnotation(session, row.documentId, row.annotationId)
      return
    case 'delete-reply':
      await deleteReply(session, row.documentId, row.annotationId, plan.replyId, { expectedBody: plan.expectedBody })
      return
  }
}

const movedUnderneath = (error: unknown) => error instanceof ConflictError || error instanceof NotFoundError

export async function undoChange(session: AuthorizedSession, id: string): Promise<AgentChangeView> {
  const { row, marks } = await loadReadable(session, id)
  if (row.undoneAt) throw new UndoRefusedError('already-undone')
  const current = marks.marks.get(row.annotationId)
  const outcome = planUndo(row, current)
  if ('refused' in outcome) throw new UndoRefusedError('moved-on', outcome.message)
  if (!mayRun(outcome.plan, marks, current, session.userId)) throw new ForbiddenError('You may not change this Anmerkung.')

  const claim = await claimUndo(session.organizationId, row.id, session.userId)
  if (!claim) throw new UndoRefusedError('already-undone')
  try {
    await runPlan(session, row, outcome.plan)
  } catch (error) {
    await releaseUndo(session.organizationId, claim)
    if (movedUnderneath(error)) throw new UndoRefusedError('moved-on')
    throw error
  }
  auditUndoneChange(session, row, outcome.plan, current?.number ?? null)

  if (outcome.plan.kind !== 'dismiss') {
    await recordDecisionScore({
      organizationId: session.organizationId,
      subject: 'change',
      subjectId: row.id,
      decision: 'undone',
      decidedBy: session.userId,
      origin: { conversationId: row.originConversationId, messageId: row.originMessageId },
    }).catch((error: unknown) => console.warn('[changes] could not score the undo', row.id, error))
  }

  const [view] = await viewsFor(session, [claim])
  if (!view) throw new NotFoundError()
  return view
}
