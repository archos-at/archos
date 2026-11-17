import 'server-only'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '@/lib/api/errors'
import { captureServer, type ServerEvent } from '@/lib/analytics/posthog-server'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentAnnotationReplyRow, DocumentAnnotationRow, AgentWakeRow } from '@/lib/db/schema/document-annotations'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { canWriteDocument } from '@/lib/documents/can-write'
import { documentDisplayName } from '@/lib/documents/display-name'
import { mayOpenDocument, mayWriteDocument } from '@/lib/documents/may-open'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { replacingDocumentOf } from './carry'
import {
  AlreadyCarriedError,
  AnnotationLimitReachedError,
  carryAnnotationToDocument,
  deleteAnnotationReply,
  deleteDocumentAnnotation,
  findDocumentAnnotation,
  insertAnnotationReply,
  insertDocumentAnnotations,
  listDocumentAnnotations,
  ReplyLimitReachedError,
  updateAnnotationReply,
  updateDocumentAnnotation,
  type AnnotationChanges,
  type AnnotationRecord,
  type CarryLink,
  type NewAnnotationValues,
} from './repository'
import { recordDecisionScore } from '@/lib/langfuse/decision-score'
import { publishToDocumentRoom } from '@/lib/realtime/document-channel'
import {
  onAssigneeChanged,
  onDueChanged,
  onMarkDeleted,
  onMarkMentioned,
  onMarkMoved,
  onMentionsWithdrawn,
  onMarkReplied,
  onMarkSettledByPerson,
  onMarksSet,
  onReplyDeleted,
  onReplyEdited,
  type MarkRef,
  type MarksSetBy,
  type SetMark,
  type MayOpen,
} from './attention'
import { auditMarkDecided } from './mark-audit'
import { keepMentions, mentionsAgent, newlyMentioned, noLongerMentioned } from './mentions'
import { enforceMentionBounds } from '@/lib/mentions/service'
import { ANNOTATION_LIFECYCLE } from './lifecycles'
import type { AnnotationChange } from './room-types'
import { auditSuppressedWake, enqueueWake, replyTrigger, wakeOutcomeOf, wakesEnabled, type EnqueuedWake } from './wake'
import { delegationEventId, wakeTurnId } from './wake-ids'
import { findWake } from './wake-repository'
import { latestWakesFor, agentWorkOf } from './agent-work'
import { wakeOfReply, wakeSpansFor, type WakeSpan } from './wake-attribution'
import {
  auditDeletedWithMark,
  readTakeBack,
  settleTakenBack,
  type EndedDelegation,
  type TakeBack,
  type TakeBackAudit,
} from './take-back'
import {
  annotationBox,
  annotationProposalSchema,
  compareAnnotations,
  createAnnotationRequestSchema,
  createReplyRequestSchema,
  MAX_ANNOTATIONS_PER_DOCUMENT,
  MAX_PROPOSALS_PER_CALL,
  MAX_REPLIES_PER_ANNOTATION,
  agentRepliedSince,
  REPLY_MARK_CLOSED_REASON,
  REPLY_TAKEN_UP_REASON,
  replyIsForAgent,
  isLive,
  updateAnnotationRequestSchema,
  updateReplyRequestSchema,
  type AnnotationAuthor,
  type AnnotationDeleteRefusal,
  type AnnotationListResponse,
  type AnnotationProposal,
  type AnnotationReplyView,
  type AnnotationStatus,
  type AnnotationView,
  type CarryLinkView,
  type CarryTargetView,
  type CreateAnnotationRequest,
  type CreateReplyRequest,
  type InternalAnnotation,
  type MarkMention,
  type AgentWakeTrigger,
  type UpdateAnnotationRequest,
  type UpdateReplyRequest,
  type WakeOutcome,
} from './types'
import { PRODUCT_NAME } from '@/lib/brand'
import { AGENT_KIND, isAgentKind } from '@/lib/agent-kind'

export interface AnnotationActor {
  kind: AnnotationAuthor
  peerId?: string | null
}

const PERSON: AnnotationActor = { kind: 'person' }
export const AGENT: AnnotationActor = { kind: AGENT_KIND }

const mayDeleteMark = (record: Pick<AnnotationRecord, 'authorKind' | 'createdBy' | 'acceptedBy'>, userId: string) =>
  record.createdBy === userId && (record.authorKind === 'person' || record.acceptedBy === userId)

export function deleteRefusalOf(
  record: Pick<AnnotationRecord, 'createdBy' | 'replies' | 'carriedFromId' | 'carriedFrom' | 'carriedTo'>
): AnnotationDeleteRefusal | null {
  if (record.carriedFromId || record.carriedFrom || record.carriedTo) return 'carried'
  const othersWrote = record.replies.some((reply) => !isAgentKind(reply.authorKind) && reply.createdBy !== record.createdBy)
  return othersWrote ? 'discussed' : null
}

const annotatable = (doc: Document) => doc.scope === 'project' || doc.scope === 'office_shelf'

type Names = ReadonlyMap<string, { name: string }>

async function directoryNames(organizationId: string): Promise<Names> {
  return loadOrganizationDirectory(organizationId).catch(() => new Map())
}

const nameOf = (names: Names, userId: string | null) => (userId ? (names.get(userId)?.name ?? null) : null)

function toReplyView(
  reply: DocumentAnnotationReplyRow,
  names: Names,
  wakes: readonly WakeSpan[]
): AnnotationReplyView {
  return {
    id: reply.id,
    annotationId: reply.annotationId,
    authorKind: reply.authorKind,
    body: reply.body,
    createdBy: reply.createdBy,
    createdByName: nameOf(names, reply.createdBy),
    createdAt: reply.createdAt.toISOString(),
    addressesPiloti: reply.addressesAgent,
    wokenBy: wakeOfReply(reply, wakes),
    mentions: reply.mentions,
    editedAt: reply.editedAt ? reply.editedAt.toISOString() : null,
  }
}

function toView(
  record: AnnotationRecord,
  doc: Document,
  session: AuthorizedSession,
  writable: boolean,
  names: Names,
  wakes: readonly WakeSpan[] = [],
  work: ReadonlyMap<string, AgentWakeRow> = new Map(),
  linked: LinkedDocuments = new Map(),
  carryWay: CarryWay | null = null
): AnnotationView {
  const wake = work.get(record.id)
  const own = writable && mayDeleteMark(record, session.userId)
  const deleteRefused = own ? deleteRefusalOf(record) : null
  return {
    id: record.id,
    documentId: record.documentId,
    number: record.number,
    page: record.page,
    shape: record.shape,
    x: record.x,
    y: record.y,
    w: record.w,
    h: record.h,
    kind: record.kind,
    body: record.body,
    mentions: record.mentions,
    basis: record.basis,
    authorKind: record.authorKind,
    status: record.status,
    assigneeUserId: record.assigneeUserId,
    assigneeName: nameOf(names, record.assigneeUserId),
    dueOn: record.dueOn,
    revisionNumber: record.revisionNumber,
    onCurrentRevision: (record.versionId ?? null) === (doc.publishedVersionId ?? null),
    createdBy: record.createdBy,
    createdByName: nameOf(names, record.createdBy),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    acceptedBy: record.acceptedBy,
    acceptedByName: nameOf(names, record.acceptedBy),
    closedBy: record.closedBy,
    closedByName: nameOf(names, record.closedBy),
    closedAt: record.closedAt ? record.closedAt.toISOString() : null,
    delegatedBy: record.delegatedBy,
    delegatedByName: nameOf(names, record.delegatedBy),
    delegatedAt: record.delegatedAt ? record.delegatedAt.toISOString() : null,
    replies: record.replies.map((reply) => toReplyView(reply, names, wakes)),
    pilotiWork: wake ? agentWorkOf(wake, nameOf(names, wake.actorUserId)) : null,
    carriedFrom: linkView(record.carriedFrom, linked),
    carriedTo: linkView(record.carriedTo, linked),
    carryTarget: writable ? carryTargetOf(record, doc, carryWay) : null,
    canEdit: writable,
    canDelete: own && deleteRefused === null,
    deleteRefused,
  }
}

type LinkedDocuments = ReadonlyMap<string, string>

const linkView = (link: CarryLink | null | undefined, linked: LinkedDocuments): CarryLinkView | null => {
  const documentName = link ? linked.get(link.documentId) : undefined
  return link && documentName !== undefined ? { ...link, documentName } : null
}

async function linkedDocuments(session: AuthorizedSession, records: readonly AnnotationRecord[]): Promise<LinkedDocuments> {
  const ids = new Set<string>()
  for (const record of records) {
    if (record.carriedFrom) ids.add(record.carriedFrom.documentId)
    if (record.carriedTo) ids.add(record.carriedTo.documentId)
  }
  const names = await Promise.all(
    [...ids].map(async (id) => {
      const doc = await getAccessibleDocument(session, id, 'read').catch(() => null)
      return doc ? ([id, documentDisplayName(doc)] as const) : null
    })
  )
  return new Map(names.filter((entry): entry is readonly [string, string] => entry !== null))
}

interface CarryWay {
  to: CarryTargetView
  across: boolean
}

async function carryWayOf(
  session: AuthorizedSession,
  doc: Document,
  records: readonly Pick<AnnotationRecord, 'status'>[]
): Promise<CarryWay | null> {
  if (!records.some((record) => record.status === 'open')) return null
  const replacing = await replacingDocumentOf(session, doc).catch((error: unknown) => {
    console.warn(`[annotations] could not read what replaces document ${doc.id}:`, error)
    return undefined
  })
  if (replacing === undefined) return null
  if (!replacing) return { to: { documentId: doc.id, documentName: documentDisplayName(doc) }, across: false }
  if (!annotatable(replacing) || !(await canWriteDocument(session, replacing.id))) return null
  return { to: { documentId: replacing.id, documentName: documentDisplayName(replacing) }, across: true }
}

function carryTargetOf(record: AnnotationRecord, doc: Document, way: CarryWay | null): CarryTargetView | null {
  if (!way || record.status !== 'open') return null
  if (way.across) return record.delegatedBy ? null : way.to
  return (record.versionId ?? null) === (doc.publishedVersionId ?? null) ? null : way.to
}

async function isAssignable(session: AuthorizedSession, doc: Document, userId: string): Promise<boolean> {
  return (await mayWriteDocument(session, doc, [userId])).has(userId)
}

async function requireAssignable(session: AuthorizedSession, doc: Document, userId: string): Promise<void> {
  if (await isAssignable(session, doc, userId)) return
  throw new UnprocessableError('The assignee cannot answer Anmerkungen on this document.', {
    field: 'assigneeUserId',
    reason: 'assignee-cannot-answer',
  })
}

const MAX_ASSIGNEE_CANDIDATES = 10

const nameKey = (value: string | null | undefined) =>
  (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')

export async function resolveAssignee(session: AuthorizedSession, doc: Document, query: string): Promise<string> {
  const key = nameKey(query)
  const people = [...(await loadOrganizationDirectory(session.organizationId)).values()]
  const exact = people.filter(
    (person) => person.userId === query.trim() || nameKey(person.name) === key || nameKey(person.email) === key
  )
  const loose = people.filter((person) => {
    const name = nameKey(person.name)
    return name.startsWith(key) || name.split(' ').includes(key)
  })
  const candidates = (exact.length > 0 ? exact : loose).slice(0, MAX_ASSIGNEE_CANDIDATES)
  const mayAnswer = await mayWriteDocument(session, doc, candidates.map((person) => person.userId))
  const reachable = candidates.filter((person) => mayAnswer.has(person.userId))
  if (reachable.length === 1) return reachable[0].userId
  if (reachable.length === 0) {
    throw new UnprocessableError(`Nobody called „${query.trim()}" can answer Anmerkungen on this document.`, {
      field: 'assignee',
      reason: 'assignee-unknown',
    })
  }
  const named = reachable.map((person) => (person.email ? `${person.name} (${person.email})` : person.name))
  throw new UnprocessableError(`„${query.trim()}" could be ${named.join(', ')}.`, {
    field: 'assignee',
    reason: 'assignee-ambiguous',
  })
}

function announce(
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

function markEvent(
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

async function requireWritableDocument(session: AuthorizedSession, documentId: string): Promise<Document> {
  const doc = await getAccessibleDocument(session, documentId, 'write')
  if (!annotatable(doc)) throw new BadRequestError('This document cannot carry Anmerkungen.')
  return doc
}

async function viewOf(session: AuthorizedSession, doc: Document, annotationId: string): Promise<AnnotationView> {
  const record = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  if (!record) throw new NotFoundError()
  const [names, wakes, work, linked, carryWay] = await Promise.all([
    directoryNames(session.organizationId),
    wakeSpansFor(session.organizationId, doc.id, [record]),
    latestWakesFor(session.organizationId, doc.id, record.id),
    linkedDocuments(session, [record]),
    carryWayOf(session, doc, [record]),
  ])
  return toView(record, doc, session, true, names, wakes, work, linked, carryWay)
}

const limitReached = (error: unknown): never => {
  if (error instanceof AnnotationLimitReachedError) {
    throw new UnprocessableError(`A document carries at most ${MAX_ANNOTATIONS_PER_DOCUMENT} Anmerkungen.`)
  }
  throw error
}

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

export async function documentAnnotationViews(
  session: AuthorizedSession,
  doc: Document,
  records: readonly AnnotationRecord[],
  { writable, names }: { writable: boolean; names?: Names }
): Promise<AnnotationView[]> {
  const [directory, wakes, work, linked, carryWay] = await Promise.all([
    names ?? directoryNames(session.organizationId),
    wakeSpansFor(session.organizationId, doc.id, records),
    latestWakesFor(session.organizationId, doc.id),
    linkedDocuments(session, records),
    writable ? carryWayOf(session, doc, records) : null,
  ])
  return records.map((record) => toView(record, doc, session, writable, directory, wakes, work, linked, carryWay))
}

export const annotationDirectory = (organizationId: string): Promise<Names> => directoryNames(organizationId)

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

function bestEffort(label: string, work: () => Promise<unknown>): void {
  const warn = (error: unknown) => console.warn(`[annotations] ${label} failed:`, error)
  try {
    void Promise.resolve(work()).catch(warn)
  } catch (error) {
    warn(error)
  }
}

function traceSettled(session: AuthorizedSession, annotationId: string, closed: boolean): void {
  bestEffort('mark the mark settled', () =>
    onMarkSettledByPerson({
      organizationId: session.organizationId,
      annotationId,
      closed,
      answeredBy: closed ? null : session.userId,
    })
  )
}

async function spendMentions(session: AuthorizedSession, mentioned: string[], piloti: boolean): Promise<string[]> {
  const count = mentioned.length + (piloti ? 1 : 0)
  if (count > 0) await enforceMentionBounds(session, count)
  return mentioned
}

function traceWithdrawn(session: AuthorizedSession, annotationId: string, withdrawn: readonly string[]): void {
  if (withdrawn.length === 0) return
  bestEffort('withdraw the mentions taken out', () =>
    onMentionsWithdrawn({ organizationId: session.organizationId, annotationId, userIds: withdrawn })
  )
}

function traceMentioned(
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

function traceSet(session: AuthorizedSession, doc: Document, by: MarksSetBy, marks: readonly SetMark[]): void {
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

const markRefOf = (session: AuthorizedSession, doc: Document, mark: { id: string; number: number }): MarkRef => ({
  organizationId: session.organizationId,
  documentId: doc.id,
  annotationId: mark.id,
  annotationNumber: mark.number,
  projectId: doc.projectId ?? null,
})

const mayOpenOf =
  (session: AuthorizedSession, doc: Document): MayOpen =>
  (userIds) =>
    mayOpenDocument(session, doc, userIds)

type ChangedMark = Pick<DocumentAnnotationRow, 'id' | 'number' | 'body' | 'assigneeUserId' | 'status' | 'dueOn'>

function traceAssigned(
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

function traceChange(
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

function traceMove(
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

const delegationOfMark = (
  session: AuthorizedSession,
  documentId: string,
  mark: Pick<AnnotationRecord, 'id' | 'delegatedAt'>
): EndedDelegation | null =>
  mark.delegatedAt
    ? { organizationId: session.organizationId, documentId, annotationId: mark.id, delegatedAt: mark.delegatedAt }
    : null

const conflict = () => new ConflictError('Somebody changed this Anmerkung a moment ago. Look again.')

function delegationOf(
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

async function carryToCurrent(
  session: AuthorizedSession,
  doc: Document,
  existing: AnnotationRecord,
  actor: AnnotationActor
): Promise<{ annotation: AnnotationView }> {
  if (existing.status !== 'open') {
    throw new UnprocessableError('Only an open Anmerkung goes on with the current Fassung.', {
      field: 'carryToCurrent',
      reason: 'not-open',
    })
  }
  const replacing = await replacingDocumentOf(session, doc)
  if (replacing) return carryAcross(session, doc, existing, replacing, actor)
  const current = doc.publishedVersionId ?? null
  if ((existing.versionId ?? null) === current) return { annotation: await viewOf(session, doc, existing.id) }
  const updated = await updateDocumentAnnotation(session.organizationId, doc.id, existing.id, 'open', {
    revision: { from: existing.versionId ?? null, to: current },
  })
  if (!updated) throw conflict()
  announce(session, doc.id, [existing.id], 'updated', actor)
  markEvent(session, 'annotation_carried', doc.id, { way: 'in_place', by: actor.kind })
  return { annotation: await viewOf(session, doc, existing.id) }
}

async function carryAcross(
  session: AuthorizedSession,
  doc: Document,
  existing: AnnotationRecord,
  replacing: Document,
  actor: AnnotationActor
): Promise<{ annotation: AnnotationView }> {
  const target = await requireWritableDocument(session, replacing.id)
  if (existing.delegatedBy) {
    throw new UnprocessableError('Take the Anmerkung back from ' + PRODUCT_NAME + ' before it goes on with the new Fassung.', {
      field: 'carryToCurrent',
      reason: 'delegated',
    })
  }
  const assignee =
    existing.assigneeUserId && (await isAssignable(session, target, existing.assigneeUserId)) ? existing.assigneeUserId : null
  const mentions = await keepMentions(session, target, existing.body, existing.mentions, { piloti: false })
  const row = await carryAnnotationToDocument({
    organizationId: session.organizationId,
    source: existing,
    target: { documentId: target.id, versionId: target.publishedVersionId ?? null },
    values: { mentions, assigneeUserId: assignee },
    closedBy: session.userId,
  }).catch((error: unknown) => {
    if (error instanceof AlreadyCarriedError) throw conflict()
    return limitReached(error)
  })
  if (!row) throw conflict()
  announce(session, doc.id, [existing.id], 'updated', actor)
  announce(session, target.id, [row.id], 'created', actor)
  markEvent(session, 'annotation_carried', doc.id, { way: 'across', by: actor.kind })
  traceSettled(session, existing.id, true)
  if (row.assigneeUserId) traceAssigned(session, target, row, null, actor)
  return { annotation: await viewOf(session, target, row.id) }
}

const takeBackAudit = (
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

function auditHeldWake(
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

export async function replyToAnnotation(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  input: CreateReplyRequest,
  actor: AnnotationActor = PERSON
): Promise<{ annotation: AnnotationView; replyId: string; wake: WakeOutcome }> {
  const { doc, existing, reply, wake, mentioned } = await postReply(session, documentId, annotationId, input, actor)
  traceMentioned(session, doc, existing, mentioned, reply.body, reply.mentions, null, reply.id)
  bestEffort('tell the thread', () =>
    onMarkReplied({
      ...markRefOf(session, doc, existing),
      actorUserId: session.userId,
      byAgent: isAgentKind(actor.kind),
      markText: existing.body,
      mark: existing,
      replyText: reply.body,
      replyId: reply.id,
      replyMentions: reply.mentions,
      mayOpen: mayOpenOf(session, doc),
      mentioned,
    })
  )
  return { annotation: await viewOf(session, doc, annotationId), replyId: reply.id, wake }
}

async function postReply(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  input: CreateReplyRequest,
  actor: AnnotationActor
): Promise<{
  doc: Document
  existing: AnnotationRecord
  reply: DocumentAnnotationReplyRow
  wake: WakeOutcome
  mentioned: string[]
}> {
  const { body, addressesPiloti, mentions: picked } = createReplyRequestSchema.parse(input)
  const doc = await requireWritableDocument(session, documentId)
  const existing = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  if (!existing) throw new NotFoundError()
  const mentions = actor.kind === 'person' ? await keepMentions(session, doc, body, picked ?? [], { piloti: true }) : []
  const mentioned = await spendMentions(session, newlyMentioned(mentions, [], session.userId), mentionsAgent(mentions))
  const addresses = actor.kind === 'person' && (Boolean(addressesPiloti) || mentionsAgent(mentions))
  const trigger = replyTrigger(existing, { authorKind: actor.kind, addressesPiloti: addresses })
  const enabled = trigger !== null && wakesEnabled(session)
  const enqueued: { wake: EnqueuedWake | null } = { wake: null }
  const reply = await insertAnnotationReply(
    {
      organizationId: session.organizationId,
      annotationId,
      authorKind: actor.kind,
      body,
      createdBy: session.userId,
      addressesAgent: addresses,
      mentions,
    },
    enabled && trigger
      ? async (tx, row) => {
          enqueued.wake = await enqueueWake(tx, {
            organizationId: session.organizationId,
            documentId: doc.id,
            annotationId,
            trigger,
            eventId: row.id,
            actor: { userId: session.userId, email: session.email || null },
          })
        }
      : undefined
  ).catch((error: unknown) => {
    if (error instanceof ReplyLimitReachedError) {
      throw new UnprocessableError(`A thread carries at most ${MAX_REPLIES_PER_ANNOTATION} replies.`)
    }
    throw error
  })
  announce(session, doc.id, [annotationId], 'replied', actor)
  if (trigger) auditHeldWake(session, doc.id, annotationId, trigger, enqueued.wake)
  if (actor.kind === 'person') traceSettled(session, annotationId, false)
  const outcome: WakeOutcome = trigger === null ? 'none' : enabled ? wakeOutcomeOf(enqueued.wake) : 'off'
  return { doc, existing, reply, wake: outcome, mentioned }
}

export async function deleteReply(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  replyId: string,
  options: { expectedBody?: string; actor?: AnnotationActor } = {}
): Promise<null> {
  const actor = options.actor ?? PERSON
  const doc = await requireWritableDocument(session, documentId)
  const existing = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  const reply = existing?.replies.find((candidate) => candidate.id === replyId)
  if (!existing || !reply) throw new NotFoundError()
  if (reply.createdBy !== session.userId) {
    throw new ForbiddenError('Only the person an answer was written for can delete it.')
  }
  if (options.expectedBody !== undefined && options.expectedBody !== reply.body) throw conflict()
  await removeReply(session, doc, existing, reply, options.expectedBody, actor)
  return null
}

async function removeReply(
  session: AuthorizedSession,
  doc: Document,
  existing: AnnotationRecord,
  reply: DocumentAnnotationReplyRow,
  expectedBody: string | undefined,
  actor: AnnotationActor
): Promise<void> {
  const gone = await deleteAnnotationReply(session.organizationId, existing.id, reply.id, expectedBody)
  if (!gone) throw conflict()
  announce(session, doc.id, [existing.id], 'updated', actor)
  const left = existing.replies.filter((candidate) => candidate.id !== reply.id)
  const withdrawn = noLongerMentioned(reply.mentions, [existing.mentions, ...left.map((candidate) => candidate.mentions)])
  bestEffort('clear the deleted reply’s rows', () =>
    onReplyDeleted({ organizationId: session.organizationId, annotationId: existing.id, replyId: reply.id, withdrawn })
  )
}

const TAKEN_UP_WAKES: ReadonlySet<AgentWakeRow['status']> = new Set(['queued', 'started', 'answered', 'stopped'])

async function agentTookUp(
  session: AuthorizedSession,
  mark: AnnotationRecord,
  reply: DocumentAnnotationReplyRow
): Promise<boolean> {
  if (!replyIsForAgent(mark, { authorKind: reply.authorKind, addressesPiloti: reply.addressesAgent })) return false
  if (agentRepliedSince(mark.replies, reply)) return true
  const wake = await findWake(session.organizationId, wakeTurnId(reply.id))
  return wake !== null && TAKEN_UP_WAKES.has(wake.status)
}

async function ownReplyOf(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  replyId: string
): Promise<{ doc: Document; existing: AnnotationRecord; reply: DocumentAnnotationReplyRow }> {
  const doc = await requireWritableDocument(session, documentId)
  const existing = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  const reply = existing?.replies.find((candidate) => candidate.id === replyId)
  if (!existing || !reply) throw new NotFoundError()
  if (reply.authorKind !== 'person' || reply.createdBy !== session.userId) {
    throw new ForbiddenError('Only the person who wrote an answer can change it.')
  }
  if (!isLive(existing)) {
    throw new UnprocessableError('The Anmerkung is closed: its thread stays as it was.', {
      reason: REPLY_MARK_CLOSED_REASON,
    })
  }
  if (await agentTookUp(session, existing, reply)) {
    throw new ConflictError(PRODUCT_NAME + ' has taken this answer up: it stays as it was. Write a new one.', {
      reason: REPLY_TAKEN_UP_REASON,
    })
  }
  return { doc, existing, reply }
}

export async function editReply(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  replyId: string,
  input: UpdateReplyRequest,
  actor: AnnotationActor = PERSON
): Promise<{ annotation: AnnotationView }> {
  const { body, mentions: picked } = updateReplyRequestSchema.parse(input)
  const { doc, existing, reply } = await ownReplyOf(session, documentId, annotationId, replyId)
  const mentions = await keepMentions(session, doc, body, picked ?? reply.mentions, {
    piloti: mentionsAgent(reply.mentions),
  })
  const mentioned = await spendMentions(session, newlyMentioned(mentions, reply.mentions, session.userId), false)
  const others = existing.replies.filter((candidate) => candidate.id !== reply.id)
  const withdrawn = noLongerMentioned(reply.mentions, [mentions, existing.mentions, ...others.map((other) => other.mentions)])
  const updated = await updateAnnotationReply(session.organizationId, existing.id, reply.id, reply.body, {
    body,
    mentions,
  })
  if (!updated) throw conflict()
  announce(session, doc.id, [existing.id], 'updated', actor)
  bestEffort('reword the reply’s rows', () =>
    onReplyEdited({
      organizationId: session.organizationId,
      annotationId: existing.id,
      replyId: updated.id,
      text: updated.body,
      mentions: updated.mentions,
    })
  )
  traceMentioned(session, doc, existing, mentioned, updated.body, updated.mentions, null, updated.id)
  traceWithdrawn(session, existing.id, withdrawn)
  return { annotation: await viewOf(session, doc, existing.id) }
}

export async function deleteOwnReply(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  replyId: string,
  actor: AnnotationActor = PERSON
): Promise<null> {
  const { doc, existing, reply } = await ownReplyOf(session, documentId, annotationId, replyId)
  await removeReply(session, doc, existing, reply, reply.body, actor)
  return null
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
