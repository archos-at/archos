import 'server-only'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getAccessibleDocument } from '@/lib/documents/access'
import { canWriteDocument } from '@/lib/documents/can-write'
import {
  deleteDocumentAnnotation,
  findDocumentAnnotation,
  insertDocumentAnnotations,
  listDocumentAnnotations,
  updateDocumentAnnotation,
  type AnnotationChanges,
  type AnnotationRecord,
  type NewAnnotationValues,
} from './repository'
import { onMarkDeleted } from './attention'
import { keepMentions, newlyMentioned, noLongerMentioned } from './mentions'
import { ANNOTATION_LIFECYCLE } from './lifecycles'
import { enqueueWake, wakeOutcomeOf, wakesEnabled, type EnqueuedWake } from './wake'
import { delegationEventId } from './wake-ids'
import { latestWakesFor } from './agent-work'
import { wakeSpansFor } from './wake-attribution'
import { auditDeletedWithMark, readTakeBack, settleTakenBack, type TakeBack } from './take-back'
import {
  annotationBox,
  annotationProposalSchema,
  compareAnnotations,
  createAnnotationRequestSchema,
  createReplyRequestSchema,
  MAX_PROPOSALS_PER_CALL,
  MAX_REPLIES_PER_ANNOTATION,
  updateAnnotationRequestSchema,
  type AnnotationListResponse,
  type AnnotationProposal,
  type AnnotationStatus,
  type AnnotationView,
  type CreateAnnotationRequest,
  type InternalAnnotation,
  type MarkMention,
  type UpdateAnnotationRequest,
  type WakeOutcome,
} from './types'
import { AGENT_KIND, isAgentKind } from '@/lib/agent-kind'
import {
  type AnnotationActor,
  PERSON,
  AGENT,
  mayDeleteMark,
  deleteRefusalOf,
  annotatable,
  requireAssignable,
  resolveAssignee,
  requireWritableDocument,
} from './annotation-access'
import {
  directoryNames,
  toView,
  linkedDocuments,
  carryWayOf,
  viewOf,
  documentAnnotationViews,
} from './annotation-views'
import { announce, markEvent, traceMove } from './annotation-events'
import { limitReached, conflict } from './annotation-errors'
import {
  bestEffort,
  spendMentions,
  traceWithdrawn,
  traceMentioned,
  traceSet,
  traceAssigned,
  traceChange,
} from './annotation-notifications'
import { delegationOfMark, delegationOf, takeBackAudit, auditHeldWake } from './annotation-delegation'
import { carryToCurrent } from './annotation-carry'
import { postReply } from './annotation-replies'

const toMark = (input: {
  page: number
  shape: NewAnnotationValues['shape']
  x: number
  y: number
  w?: number | null
  h?: number | null
  kind: NewAnnotationValues['kind']
  body: string
  mentions?: MarkMention[]
  basis?: string | null
  assigneeUserId?: string | null
  dueOn?: string | null
}): NewAnnotationValues => ({
  page: input.page,
  shape: input.shape,
  x: input.x,
  y: input.y,
  w: input.shape === 'region' ? (input.w ?? null) : null,
  h: input.shape === 'region' ? (input.h ?? null) : null,
  kind: input.kind,
  body: input.body,
  mentions: input.mentions ?? [],
  basis: input.basis ?? null,
  assigneeUserId: input.assigneeUserId ?? null,
  dueOn: input.dueOn ?? null,
})

export async function listAnnotations(session: AuthorizedSession, documentId: string): Promise<AnnotationListResponse> {
  const doc = await getAccessibleDocument(session, documentId, 'read')
  if (!annotatable(doc)) return { annotations: [], canAnnotate: false, pilotiWakes: false }
  const [records, writable, names] = await Promise.all([
    listDocumentAnnotations(session.organizationId, doc.id),
    canWriteDocument(session, doc.id),
    directoryNames(session.organizationId),
  ])
  const annotations = (await documentAnnotationViews(session, doc, records, { writable, names })).sort(compareAnnotations)
  return { annotations, canAnnotate: writable, pilotiWakes: wakesEnabled(session) }
}

export async function createAnnotation(
  session: AuthorizedSession,
  documentId: string,
  input: CreateAnnotationRequest,
  actor: AnnotationActor = PERSON
): Promise<{ annotation: AnnotationView }> {
  const parsed = createAnnotationRequestSchema.parse(input)
  const doc = await requireWritableDocument(session, documentId)
  if (parsed.assigneeUserId) await requireAssignable(session, doc, parsed.assigneeUserId)
  const mentions = await keepMentions(session, doc, parsed.body, parsed.mentions ?? [], { piloti: false })
  const mentioned = await spendMentions(session, newlyMentioned(mentions, [], session.userId), false)
  const [row] = await insertDocumentAnnotations({
    organizationId: session.organizationId,
    documentId: doc.id,
    versionId: doc.publishedVersionId ?? null,
    authorKind: 'person',
    createdBy: session.userId,
    marks: [toMark({ ...parsed, mentions })],
  }).catch(limitReached)
  announce(session, doc.id, [row.id], 'created', { ...actor, kind: 'person' })
  markEvent(session, 'annotation_created', doc.id, { author_kind: 'person', kind: row.kind, status: row.status })
  if (row.assigneeUserId) traceAssigned(session, doc, row, null, PERSON)
  traceMentioned(session, doc, row, mentioned, row.body, mentions, row.assigneeUserId)
  traceSet(session, doc, 'created', [{ ...row, toldOtherwise: [row.assigneeUserId, ...mentioned] }])
  return { annotation: await viewOf(session, doc, row.id) }
}

export async function proposeAnnotations(
  session: AuthorizedSession,
  documentId: string,
  proposals: readonly AnnotationProposal[]
): Promise<{ annotations: AnnotationView[] }> {
  return insertAgentMarks(session, documentId, proposals, null)
}

export async function setAnnotationsForAsker(
  session: AuthorizedSession,
  documentId: string,
  marks: readonly AnnotationProposal[]
): Promise<{ annotations: AnnotationView[] }> {
  return insertAgentMarks(session, documentId, marks, session.userId)
}

async function insertAgentMarks(
  session: AuthorizedSession,
  documentId: string,
  proposals: readonly AnnotationProposal[],
  acceptedBy: string | null
): Promise<{ annotations: AnnotationView[] }> {
  if (proposals.length === 0 || proposals.length > MAX_PROPOSALS_PER_CALL) {
    throw new BadRequestError(`Between 1 and ${MAX_PROPOSALS_PER_CALL} marks per call.`)
  }
  const parsed = proposals.map((proposal) => annotationProposalSchema.parse(proposal))
  const doc = await requireWritableDocument(session, documentId)
  const rows = await insertDocumentAnnotations({
    organizationId: session.organizationId,
    documentId: doc.id,
    versionId: doc.publishedVersionId ?? null,
    authorKind: AGENT_KIND,
    createdBy: session.userId,
    acceptedBy,
    marks: parsed.map(toMark),
  }).catch(limitReached)
  const ids = rows.map((row) => row.id)
  announce(session, doc.id, ids, 'created', AGENT)
  for (const row of rows) {
    markEvent(session, 'annotation_created', doc.id, { author_kind: AGENT_KIND, kind: row.kind, status: row.status })
  }
  if (acceptedBy) {
    traceSet(
      session,
      doc,
      'created_piloti',
      rows.map((row) => ({ ...row, toldOtherwise: row.kind === 'question' ? [row.assigneeUserId] : [] }))
    )
  }
  const names = await directoryNames(session.organizationId)
  const records = await listDocumentAnnotations(session.organizationId, doc.id)
  const annotations = records
    .filter((record) => ids.includes(record.id))
    .map((record) => toView(record, doc, session, true, names))
  return { annotations }
}

export function transition(
  from: AnnotationStatus,
  to: 'open' | 'resolved' | 'dismissed',
  record: Pick<AnnotationRecord, 'acceptedBy' | 'authorKind'>,
  userId: string,
  now: Date
): NonNullable<AnnotationChanges['transition']> {
  const closed = { closedBy: userId, closedAt: now }
  const reopened = { closedBy: null, closedAt: null }
  const acceptance = record.acceptedBy ? {} : { acceptedBy: userId, acceptedAt: now }
  if (!ANNOTATION_LIFECYCLE.canTransition(from, to)) {
    throw new ConflictError(`An Anmerkung cannot go from ${from} to ${to}.`)
  }
  if (to !== 'open') return { status: to, ...closed }
  const accepts = from === 'proposed' || (from === 'dismissed' && isAgentKind(record.authorKind))
  return { status: 'open', ...reopened, ...(accepts ? acceptance : {}) }
}

export async function updateAnnotation(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  input: UpdateAnnotationRequest,
  actor: AnnotationActor = PERSON
): Promise<{ annotation: AnnotationView; wake?: WakeOutcome }> {
  const parsed = updateAnnotationRequestSchema.parse(input)
  const doc = await requireWritableDocument(session, documentId)
  const existing = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  if (!existing) throw new NotFoundError()
  if (parsed.expectedStatus && parsed.expectedStatus !== existing.status) throw conflict()
  if (parsed.carryToCurrent) return carryToCurrent(session, doc, existing, actor)
  if (parsed.assigneeUserId) await requireAssignable(session, doc, parsed.assigneeUserId)
  const mentions =
    parsed.body === undefined
      ? undefined
      : await keepMentions(session, doc, parsed.body, parsed.mentions ?? existing.mentions, { piloti: false })
  const closes = parsed.status === 'resolved' || parsed.status === 'dismissed'
  const mentioned =
    mentions && !closes ? await spendMentions(session, newlyMentioned(mentions, existing.mentions, session.userId), false) : []
  const withdrawn = mentions
    ? noLongerMentioned(existing.mentions, [mentions, ...existing.replies.map((reply) => reply.mentions)])
    : []

  const now = new Date()
  const changes: AnnotationChanges = {
    ...(parsed.kind !== undefined && { kind: parsed.kind }),
    ...(parsed.body !== undefined && { body: parsed.body }),
    ...(mentions !== undefined && { mentions }),
    ...(parsed.basis !== undefined && { basis: parsed.basis }),
    ...(parsed.assigneeUserId !== undefined && { assigneeUserId: parsed.assigneeUserId }),
    ...(parsed.dueOn !== undefined && { dueOn: parsed.dueOn }),
  }
  const moves = parsed.status !== undefined && parsed.status !== existing.status
  if (moves && parsed.status) {
    changes.transition = transition(existing.status, parsed.status, existing, session.userId, now)
  }
  const delegation = delegationOf(session, existing, { ...parsed, status: moves ? parsed.status : undefined }, actor, now)
  if (delegation) changes.delegation = delegation
  if (Object.keys(changes).length === 0) return { annotation: await viewOf(session, doc, annotationId) }

  const delegating = delegation?.delegatedBy ? delegation.delegatedAt : null
  const ended = delegation && delegation.delegatedBy === null ? delegationOfMark(session, doc.id, existing) : null
  const stopTurn = actor.kind === 'person'
  const enqueued: { wake: EnqueuedWake | null; takeBack: TakeBack | null } = { wake: null, takeBack: null }
  const updated = await updateDocumentAnnotation(
    session.organizationId,
    doc.id,
    annotationId,
    existing.status,
    changes,
    delegating || ended
      ? async (tx) => {
          if (ended) enqueued.takeBack = await readTakeBack(tx, ended, { stopTurn })
          if (!delegating) return
          enqueued.wake = await enqueueWake(tx, {
            organizationId: session.organizationId,
            documentId: doc.id,
            annotationId,
            trigger: 'assigned',
            eventId: delegationEventId(annotationId, delegating),
            actor: { userId: session.userId, email: session.email || null },
          })
        }
      : undefined
  )
  if (!updated) throw conflict()
  announce(session, doc.id, [annotationId], 'updated', actor)
  auditHeldWake(session, doc.id, annotationId, 'assigned', enqueued.wake)
  if (ended && enqueued.takeBack) {
    const { takeBack } = enqueued
    const by = takeBackAudit(session, doc, existing, actor)
    await settleTakenBack(ended, takeBack, { stopTurn }, by).catch((error: unknown) =>
      console.warn('[annotations] could not keep a taken-back wake from starting:', error)
    )
  }
  traceChange(
    session,
    doc,
    existing,
    {
      id: annotationId,
      number: existing.number,
      body: changes.body ?? existing.body,
      assigneeUserId: changes.assigneeUserId !== undefined ? changes.assigneeUserId : existing.assigneeUserId,
      status: changes.transition?.status ?? existing.status,
      dueOn: changes.dueOn !== undefined ? changes.dueOn : existing.dueOn,
    },
    actor
  )
  if (actor.kind === 'person' && moves) {
    traceMove(session, { id: doc.id, projectId: doc.projectId ?? null }, annotationId, existing, parsed.status)
  }
  const reopens = parsed.status === 'open' && (existing.status === 'resolved' || existing.status === 'dismissed')
  if (moves && parsed.status && (closes || reopens)) {
    const event = reopens ? 'annotation_reopened' : 'annotation_closed'
    markEvent(session, event, doc.id, { status: parsed.status, by: actor.kind, author_kind: existing.authorKind, was: existing.status })
  }
  traceMentioned(
    session,
    doc,
    existing,
    mentioned,
    changes.body ?? existing.body,
    mentions ?? existing.mentions,
    changes.assigneeUserId !== undefined && changes.assigneeUserId !== existing.assigneeUserId ? changes.assigneeUserId : null
  )
  traceWithdrawn(session, annotationId, withdrawn)
  const annotation = await viewOf(session, doc, annotationId)
  return delegating ? { annotation, wake: wakeOutcomeOf(enqueued.wake) } : { annotation }
}

export async function deleteAnnotation(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  actor: AnnotationActor = PERSON
): Promise<null> {
  const doc = await requireWritableDocument(session, documentId)
  const existing = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  if (!existing) throw new NotFoundError()
  if (!mayDeleteMark(existing, session.userId)) {
    throw new ForbiddenError('Only the person who set an Anmerkung can delete it. Resolve or dismiss it instead.')
  }
  const refused = deleteRefusalOf(existing)
  if (refused === 'discussed') {
    throw new ConflictError('Somebody else has answered in this thread. Resolve the Anmerkung instead.', {
      reason: 'mark-discussed',
    })
  }
  if (refused === 'carried') {
    throw new ConflictError('This Anmerkung was carried on between documents. Resolve it instead.', {
      reason: 'mark-carried',
    })
  }
  const ended = delegationOfMark(session, doc.id, existing)
  const stopTurn = actor.kind === 'person'
  const found: { takeBack: TakeBack | null } = { takeBack: null }
  await deleteDocumentAnnotation(
    session.organizationId,
    doc.id,
    annotationId,
    ended
      ? async (tx) => {
          found.takeBack = await readTakeBack(tx, ended, { stopTurn })
        }
      : undefined
  )
  announce(session, doc.id, [annotationId], 'deleted', actor)
  if (found.takeBack) auditDeletedWithMark(found.takeBack, takeBackAudit(session, doc, existing, actor))
  bestEffort('clear the deleted mark’s rows', () =>
    onMarkDeleted({ organizationId: session.organizationId, annotationId })
  )
  return null
}

export async function readAnnotation(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string
): Promise<AnnotationView> {
  const doc = await getAccessibleDocument(session, documentId, 'read')
  const record = annotatable(doc) ? await findDocumentAnnotation(session.organizationId, doc.id, annotationId) : null
  if (!record) throw new NotFoundError()
  const [writable, names, wakes, work, linked] = await Promise.all([
    canWriteDocument(session, doc.id),
    directoryNames(session.organizationId),
    wakeSpansFor(session.organizationId, doc.id, [record]),
    latestWakesFor(session.organizationId, doc.id, record.id),
    linkedDocuments(session, [record]),
  ])
  const carryWay = writable ? await carryWayOf(session, doc, [record]) : null
  return toView(record, doc, session, writable, names, wakes, work, linked, carryWay)
}

export interface AskedChange {
  status?: 'open' | 'resolved' | 'dismissed'
  assignee?: string | null
  dueOn?: string | null
  kind?: AnnotationView['kind']
  body?: string
  expectedStatus?: AnnotationStatus
}

const CHANGEABLE = ['status', 'assigneeUserId', 'dueOn', 'kind', 'body'] as const
export type ChangeableField = (typeof CHANGEABLE)[number]

export const changedFields = (before: AnnotationView, after: AnnotationView): ChangeableField[] =>
  CHANGEABLE.filter((field) => before[field] !== after[field])

export async function updateAnnotationForAsker(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  change: AskedChange,
  note: string
): Promise<{ before: AnnotationView; after: AnnotationView; changed: ChangeableField[] }> {
  const { body: noteBody } = createReplyRequestSchema.parse({ body: note })
  const doc = await requireWritableDocument(session, documentId)
  const before = await viewOf(session, doc, annotationId)
  if (change.expectedStatus && change.expectedStatus !== before.status) throw conflict()
  if (before.replies.length >= MAX_REPLIES_PER_ANNOTATION) {
    throw new UnprocessableError(`A thread carries at most ${MAX_REPLIES_PER_ANNOTATION} replies.`)
  }
  const assigneeUserId =
    change.assignee === undefined || change.assignee === null
      ? change.assignee
      : await resolveAssignee(session, doc, change.assignee)
  const { annotation: after } = await updateAnnotation(
    session,
    doc.id,
    annotationId,
    {
      ...(change.status !== undefined && { status: change.status }),
      ...(assigneeUserId !== undefined && { assigneeUserId }),
      ...(change.dueOn !== undefined && { dueOn: change.dueOn }),
      ...(change.kind !== undefined && { kind: change.kind }),
      ...(change.body !== undefined && { body: change.body }),
      expectedStatus: change.expectedStatus ?? before.status,
    },
    AGENT
  )
  const changed = changedFields(before, after)
  if (changed.length === 0) return { before, after, changed }
  await postReply(session, doc.id, annotationId, { body: noteBody }, AGENT)
  return { before, after: await viewOf(session, doc, annotationId), changed }
}

export async function listAnnotationsForAgent(
  session: AuthorizedSession,
  documentId: string
): Promise<{ documentId: string; annotations: InternalAnnotation[] }> {
  const { annotations } = await listAnnotations(session, documentId)
  return {
    documentId,
    annotations: annotations.map((annotation) => ({
      id: annotation.id,
      number: annotation.number,
      page: annotation.page,
      shape: annotation.shape,
      box: annotationBox(annotation),
      kind: annotation.kind,
      status: annotation.status,
      authorKind: annotation.authorKind,
      body: annotation.body,
      basis: annotation.basis,
      assigneeName: annotation.assigneeName,
      dueOn: annotation.dueOn,
      onCurrentRevision: annotation.onCurrentRevision,
      createdByName: annotation.createdByName,
      createdAt: annotation.createdAt,
      replies: annotation.replies.map((reply) => ({
        authorKind: reply.authorKind,
        body: reply.body,
        createdByName: reply.createdByName,
      })),
    })),
  }
}

export type { AnnotationActor } from './annotation-access'
export { AGENT, deleteRefusalOf, resolveAssignee } from './annotation-access'
export { documentAnnotationViews, annotationDirectory } from './annotation-views'
export { replyToAnnotation, deleteReply, editReply, deleteOwnReply } from './annotation-replies'
