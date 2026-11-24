import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentAnnotationRow } from '@/lib/db/schema/document-annotations'
import type { Document } from '@/lib/db/schema/documents'
import { mayOpenDocument } from '@/lib/documents/may-open'
import type { AnnotationRecord } from './repository'
import {
  onAssigneeChanged,
  onDueChanged,
  onMarkMentioned,
  onMarkMoved,
  onMentionsWithdrawn,
  onMarkSettledByPerson,
  onMarksSet,
  type MarkRef,
  type MarksSetBy,
  type SetMark,
  type MayOpen,
} from './attention'
import { enforceMentionBounds } from '@/lib/mentions/service'
import type { MarkMention } from './types'
import { isAgentKind } from '@/lib/agent-kind'
import type { AnnotationActor } from './annotation-access'

export function bestEffort(label: string, work: () => Promise<unknown>): void {
  const warn = (error: unknown) => console.warn(`[annotations] ${label} failed:`, error)
  try {
    void Promise.resolve(work()).catch(warn)
  } catch (error) {
    warn(error)
  }
}

export function traceSettled(session: AuthorizedSession, annotationId: string, closed: boolean): void {
  bestEffort('mark the mark settled', () =>
    onMarkSettledByPerson({
      organizationId: session.organizationId,
      annotationId,
      closed,
      answeredBy: closed ? null : session.userId,
    })
  )
}

export async function spendMentions(session: AuthorizedSession, mentioned: string[], piloti: boolean): Promise<string[]> {
  const count = mentioned.length + (piloti ? 1 : 0)
  if (count > 0) await enforceMentionBounds(session, count)
  return mentioned
}

export function traceWithdrawn(session: AuthorizedSession, annotationId: string, withdrawn: readonly string[]): void {
  if (withdrawn.length === 0) return
  bestEffort('withdraw the mentions taken out', () =>
    onMentionsWithdrawn({ organizationId: session.organizationId, annotationId, userIds: withdrawn })
  )
}

export function traceMentioned(
  session: AuthorizedSession,
  doc: Document,
  mark: { id: string; number: number },
  mentioned: readonly string[],
  text: string,
  mentions: readonly MarkMention[],
  assignedNow: string | null = null,
  replyId: string | null = null
): void {
  const told = mentioned.filter((userId) => userId !== assignedNow)
  if (told.length === 0) return
  bestEffort('tell the people mentioned', () =>
    onMarkMentioned({
      ...markRefOf(session, doc, mark),
      actorUserId: session.userId,
      byAgent: false,
      markText: text,
      mentioned: told,
      text,
      mentions,
      replyId,
      mayOpen: mayOpenOf(session, doc),
    })
  )
}

export function traceSet(session: AuthorizedSession, doc: Document, by: MarksSetBy, marks: readonly SetMark[]): void {
  bestEffort('tell the document’s people', () =>
    onMarksSet({
      organizationId: session.organizationId,
      documentId: doc.id,
      projectId: doc.projectId ?? null,
      actorUserId: session.userId,
      uploaderUserId: doc.createdBy ?? null,
      by,
      marks,
      mayOpen: mayOpenOf(session, doc),
    })
  )
}

export const markRefOf = (session: AuthorizedSession, doc: Document, mark: { id: string; number: number }): MarkRef => ({
  organizationId: session.organizationId,
  documentId: doc.id,
  annotationId: mark.id,
  annotationNumber: mark.number,
  projectId: doc.projectId ?? null,
})

export const mayOpenOf =
  (session: AuthorizedSession, doc: Document): MayOpen =>
  (userIds) =>
    mayOpenDocument(session, doc, userIds)

type ChangedMark = Pick<DocumentAnnotationRow, 'id' | 'number' | 'body' | 'assigneeUserId' | 'status' | 'dueOn'>

export function traceAssigned(
  session: AuthorizedSession,
  doc: Document,
  mark: ChangedMark,
  previous: string | null,
  actor: AnnotationActor
): void {
  bestEffort('tell the Zuständige', () =>
    onAssigneeChanged({
      ...markRefOf(session, doc, mark),
      actorUserId: session.userId,
      byAgent: isAgentKind(actor.kind),
      markText: mark.body,
      previousAssigneeUserId: previous,
      assigneeUserId: mark.assigneeUserId,
      open: mark.status === 'open',
      dueOn: mark.dueOn,
    })
  )
}

function traceRedated(session: AuthorizedSession, doc: Document, mark: ChangedMark, actor: AnnotationActor): void {
  bestEffort('tell the Zuständige the date', () =>
    onDueChanged({
      ...markRefOf(session, doc, mark),
      actorUserId: session.userId,
      byAgent: isAgentKind(actor.kind),
      markText: mark.body,
      assigneeUserId: mark.assigneeUserId,
      dueOn: mark.dueOn,
      open: mark.status === 'open',
    })
  )
}

export function traceChange(
  session: AuthorizedSession,
  doc: Document,
  existing: AnnotationRecord,
  after: ChangedMark,
  actor: AnnotationActor
): void {
  const reassigned = after.assigneeUserId !== existing.assigneeUserId
  const takenOver = existing.status === 'proposed' && after.status === 'open'
  if (reassigned || (takenOver && after.assigneeUserId)) {
    traceAssigned(session, doc, after, reassigned ? existing.assigneeUserId : null, actor)
  } else if (after.dueOn !== existing.dueOn && after.assigneeUserId) {
    traceRedated(session, doc, after, actor)
  }
  if (isAgentKind(existing.authorKind) && existing.acceptedBy === null && after.status === 'open') {
    traceSet(session, doc, 'created_piloti', [
      { ...after, mentions: existing.mentions, toldOtherwise: [after.assigneeUserId] },
    ])
  }
  if (after.status === existing.status) return
  const closedAs = after.status === 'resolved' || after.status === 'dismissed' ? after.status : null
  if (closedAs) traceSettled(session, existing.id, true)
  const move = closedAs ?? (existing.status === 'proposed' ? null : 'reopened')
  if (!move) return
  bestEffort('tell the mark’s author', () =>
    onMarkMoved({
      ...markRefOf(session, doc, existing),
      actorUserId: session.userId,
      byAgent: isAgentKind(actor.kind),
      markText: after.body,
      move,
      mark: existing,
      mayOpen: mayOpenOf(session, doc),
    })
  )
}
