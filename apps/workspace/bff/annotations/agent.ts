import 'server-only'
import { ApiError, BadRequestError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isAgentActsEnabled } from '@/lib/authz/feature-flags'
import { LEGACY_AGENT_DIRECT_EDITS_OFF } from '@/lib/authz/legacy-feature-flags'
import { recordAgentChanges, type AppliedChange, type ChangeOrigin } from '@/lib/changes/service'
import { fieldsOf, markState, replyState } from '@/lib/changes/state'
import { findConversationInOrg } from '@/lib/conversations/repository'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import { findDocumentInOrg } from '@/lib/documents/repository'
import { getAccessibleDocument } from '@/lib/documents/access'
import { admitSubjectRead } from '@/lib/documents/version-content'
import { type AgentRoomOp, agentPeer, publishAsAgent, roomSnapshot } from '@/lib/realtime/document-channel'
import type { VerifiedRequestContext } from '@/lib/request-context'
import { onAgentWrote } from './attention'
import {
  deleteAnnotation,
  listAnnotationsForAgent,
  AGENT,
  proposeAnnotations,
  readAnnotation,
  replyToAnnotation,
  setAnnotationsForAsker,
  updateAnnotationForAsker,
  type ChangeableField,
} from './service'
import type { AnnotationView, InternalAnnotationRequest, InternalMarkFields } from './types'
import { PRODUCT_NAME } from '@/lib/brand'

export class NoDocumentSubjectError extends UnprocessableError {
  constructor() {
    super('This conversation is not about a document. Open the document and ask ' + PRODUCT_NAME + ' from there.', {
      reason: 'no-document-subject',
    })
  }
}

const ACTING_OPS: ReadonlySet<InternalAnnotationRequest['op']> = new Set(['create', 'update', 'delete'])

export class AgentActsOffError extends ApiError {
  constructor(op: InternalAnnotationRequest['op']) {
    super(
      403,
      LEGACY_AGENT_DIRECT_EDITS_OFF.code,
      'This organization has ' + PRODUCT_NAME + ' propose only: it does not set, change or delete Anmerkungen for a person. ' +
        'Propose the mark instead, or tell the person to make the change themselves.',
      { reason: LEGACY_AGENT_DIRECT_EDITS_OFF.reason, op }
    )
  }
}

export interface AgentDocument {
  id: string
  name: string
  projectId: string | null
}

export async function resolveAgentDocument(
  context: VerifiedRequestContext,
  requestedId: string | null,
  answerMessageId: string | null
): Promise<AgentDocument> {
  if (!context.conversationId) throw new NoDocumentSubjectError()
  const conversation = await findConversationInOrg(context.conversationId, context.organizationId)
  const subjectId =
    conversation?.subjectResourceType === 'document' ? (conversation.subjectResourceId ?? null) : null
  const documentId = requestedId ?? subjectId
  if (!documentId) throw new NoDocumentSubjectError()
  const document = await findDocumentInOrg(documentId, context.organizationId, SCREENED_ONLY)
  if (!document) throw new NotFoundError('Document not found')
  if (documentId !== subjectId && !context.collectionScope.includes(document.collectionName)) {
    throw new NotFoundError('Document not found')
  }
  await admitSubjectRead(document, context.organizationId, context.conversationId, {
    askerUserId: context.userId,
    answerMessageId,
  })
  return { id: document.id, name: document.filename, projectId: document.projectId ?? null }
}

interface AgentInRoom {
  organizationId: string
  conversationId: string
  onBehalfOf: string
}

async function readRoom(session: AuthorizedSession, document: AgentDocument, agent: AgentInRoom) {
  const { annotations } = await listAnnotationsForAgent(session, document.id)
  const numbers = new Map(annotations.map((annotation) => [annotation.id, annotation.number]))
  const self = agentPeer(agent.conversationId, agent.onBehalfOf).peerId
  const peers = (await roomSnapshot(document.id, agent.organizationId)).filter((peer) => peer.peerId !== self)
  return {
    documentId: document.id,
    documentName: document.name,
    peers: peers.map((peer) => ({
      name: peer.name,
      kind: peer.kind,
      page: peer.page,
      viewport: peer.viewport,
      selectedMarkNumber: (peer.selected && numbers.get(peer.selected)) ?? null,
      draft: peer.draft,
    })),
    marks: {
      open: annotations.filter((annotation) => annotation.status === 'open').length,
      proposed: annotations.filter((annotation) => annotation.status === 'proposed').length,
    },
  }
}

async function gesture(session: AuthorizedSession, document: AgentDocument, agent: AgentInRoom, ops: AgentRoomOp[]) {
  await getAccessibleDocument(session, document.id, 'read')
  for (const op of ops) {
    await publishAsAgent(document.id, agent.organizationId, agent, op)
  }
  return { documentId: document.id, documentName: document.name, ok: true as const }
}

const setMark = (annotation: AnnotationView) => ({
  id: annotation.id,
  number: annotation.number,
  page: annotation.page,
  shape: annotation.shape,
  x: annotation.x,
  y: annotation.y,
  w: annotation.w,
  h: annotation.h,
  kind: annotation.kind,
  body: annotation.body,
})

const movedFields = (view: AnnotationView, changed: readonly ChangeableField[]): InternalMarkFields => ({
  ...(changed.includes('status') && { status: view.status }),
  ...(changed.includes('assigneeUserId') && { assigneeUserId: view.assigneeUserId, assigneeName: view.assigneeName }),
  ...(changed.includes('dueOn') && { dueOn: view.dueOn }),
  ...(changed.includes('kind') && { kind: view.kind }),
  ...(changed.includes('body') && { body: view.body }),
})

interface Turn {
  origin: ChangeOrigin
  document: AgentDocument
}

async function tellAttention(
  turn: Turn,
  mark: Pick<AnnotationView, 'id' | 'number' | 'assigneeUserId'>,
  what: 'mark' | 'question' | 'reply',
  replyId: string | null
): Promise<void> {
  await onAgentWrote({
    organizationId: turn.origin.organizationId,
    documentId: turn.document.id,
    annotationId: mark.id,
    annotationNumber: mark.number,
    projectId: turn.document.projectId,
    onBehalfOf: turn.origin.onBehalfOf,
    assigneeUserId: mark.assigneeUserId,
    what,
    replyId,
  }).catch((error: unknown) => console.warn('[annotations] attention for a write of ' + PRODUCT_NAME + ' failed', mark.id, error))
}

const markChange = (mark: AnnotationView, change: Pick<AppliedChange, 'op' | 'before' | 'after'>): AppliedChange => ({
  objectKind: 'annotation',
  objectId: mark.id,
  annotationId: mark.id,
  annotationNumber: mark.number,
  ...change,
})

async function afterSet(turn: Turn, marks: readonly AnnotationView[]): Promise<void> {
  await recordAgentChanges(
    turn.origin,
    marks.map((mark) => markChange(mark, { op: 'create', before: null, after: markState(mark) }))
  )
  for (const mark of marks) await tellAttention(turn, mark, mark.kind === 'question' ? 'question' : 'mark', null)
}

type UpdateRequest = Extract<InternalAnnotationRequest, { op: 'update' }>

async function update(session: AuthorizedSession, turn: Turn, request: UpdateRequest) {
  const { document } = turn
  const { annotationId, note, expectedStatus, status, assignee, dueOn, kind, body } = request
  if ([status, assignee, dueOn, kind, body].every((value) => value === undefined)) {
    throw new BadRequestError('Name at least one change: status, assignee, dueOn, kind or body.')
  }
  const { before, after, changed } = await updateAnnotationForAsker(
    session,
    document.id,
    annotationId,
    { status, assignee, dueOn, kind, body, expectedStatus },
    note
  )
  if (changed.length > 0) {
    await recordAgentChanges(turn.origin, [
      markChange(after, { op: 'update', before: fieldsOf(before, changed), after: fieldsOf(after, changed) }),
    ])
  }
  return {
    documentId: document.id,
    documentName: document.name,
    annotationId: after.id,
    number: after.number,
    status: after.status,
    before: movedFields(before, changed),
    after: movedFields(after, changed),
    noted: changed.length > 0,
  }
}

async function remove(session: AuthorizedSession, turn: Turn, annotationId: string) {
  const { document } = turn
  const mark = await readAnnotation(session, document.id, annotationId)
  await deleteAnnotation(session, document.id, annotationId, AGENT)
  await recordAgentChanges(turn.origin, [markChange(mark, { op: 'delete', before: markState(mark), after: null })])
  return { documentId: document.id, documentName: document.name, annotationId: mark.id, number: mark.number, body: mark.body }
}

async function reply(session: AuthorizedSession, turn: Turn, annotationId: string, body: string) {
  const { document } = turn
  const { annotation, replyId } = await replyToAnnotation(session, document.id, annotationId, { body }, AGENT)
  const stored = annotation.replies.find((entry) => entry.id === replyId)
  await recordAgentChanges(turn.origin, [
    {
      objectKind: 'annotation_reply',
      objectId: replyId,
      annotationId: annotation.id,
      annotationNumber: annotation.number,
      op: 'create',
      before: null,
      after: replyState(stored?.body ?? body.trim()),
    },
  ])
  await tellAttention(turn, annotation, 'reply', replyId)
  return {
    documentId: document.id,
    documentName: document.name,
    annotationId: annotation.id,
    number: annotation.number,
    replies: annotation.replies.length,
  }
}

export async function runAgentAnnotationRequest(
  session: AuthorizedSession,
  document: AgentDocument,
  request: InternalAnnotationRequest,
  agent: AgentInRoom
) {
  if (ACTING_OPS.has(request.op) && !isAgentActsEnabled(session)) throw new AgentActsOffError(request.op)
  const documentId = document.id
  const turn: Turn = {
    document,
    origin: {
      organizationId: agent.organizationId,
      documentId,
      conversationId: agent.conversationId,
      answerMessageId: request.answerMessageId ?? null,
      onBehalfOf: agent.onBehalfOf,
      onBehalfOfEmail: session.email || null,
      projectId: document.projectId,
    },
  }
  switch (request.op) {
    case 'room':
      return readRoom(session, document, agent)
    case 'point':
      return gesture(session, document, agent, [
        { op: 'presence', state: 'here' },
        { op: 'cursor', cursor: { page: request.page, x: request.x, y: request.y }, label: request.label },
      ])
    case 'highlight': {
      const box = {
        page: request.page,
        x: request.x,
        y: request.y,
        w: Math.min(request.w, 1 - request.x),
        h: Math.min(request.h, 1 - request.y),
      }
      return gesture(session, document, agent, [
        { op: 'presence', state: 'here' },
        { op: 'highlight', box, label: request.label },
      ])
    }
    case 'look': {
      const { page, x, y, w, h } = request
      const box =
        x !== undefined && y !== undefined && w !== undefined && h !== undefined
          ? { page, x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }
          : { page, x: 0, y: 0, w: 1, h: 1 }
      return gesture(session, document, agent, [
        { op: 'presence', state: 'here' },
        { op: 'activity', state: 'reading', box },
      ])
    }
    case 'leave':
      return gesture(session, document, agent, [
        { op: 'cursor', cursor: null },
        { op: 'activity', state: 'idle' },
        { op: 'presence', state: 'gone' },
      ])
    case 'list':
      return { ...(await listAnnotationsForAgent(session, documentId)), documentName: document.name }
    case 'propose': {
      const { annotations } = await proposeAnnotations(session, documentId, request.proposals)
      await afterSet(turn, annotations)
      return { documentId, documentName: document.name, proposed: annotations.map(setMark) }
    }
    case 'create': {
      const { annotations } = await setAnnotationsForAsker(session, documentId, request.marks)
      await afterSet(turn, annotations)
      return { documentId, documentName: document.name, created: annotations.map(setMark) }
    }
    case 'update':
      return update(session, turn, request)
    case 'delete':
      return remove(session, turn, request.annotationId)
    case 'reply':
      return reply(session, turn, request.annotationId, request.body)
  }
}
