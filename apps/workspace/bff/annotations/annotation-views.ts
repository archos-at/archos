import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentAnnotationReplyRow, AgentWakeRow } from '@/lib/db/schema/document-annotations'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { canWriteDocument } from '@/lib/documents/can-write'
import { documentDisplayName } from '@/lib/documents/display-name'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { replacingDocumentOf } from './carry'
import { findDocumentAnnotation, type AnnotationRecord, type CarryLink } from './repository'
import { latestWakesFor, agentWorkOf } from './agent-work'
import { wakeOfReply, wakeSpansFor, type WakeSpan } from './wake-attribution'
import type { AnnotationReplyView, AnnotationView, CarryLinkView, CarryTargetView } from './types'
import { mayDeleteMark, deleteRefusalOf, annotatable } from './annotation-access'

type Names = ReadonlyMap<string, { name: string }>

export async function directoryNames(organizationId: string): Promise<Names> {
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

export function toView(
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

export async function linkedDocuments(session: AuthorizedSession, records: readonly AnnotationRecord[]): Promise<LinkedDocuments> {
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

export async function carryWayOf(
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

export async function viewOf(session: AuthorizedSession, doc: Document, annotationId: string): Promise<AnnotationView> {
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
