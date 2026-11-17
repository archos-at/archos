import 'server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import type { DbTransaction } from '@/lib/db/executor'
import { documentAnnotationReplies, documentAnnotations, type DocumentAnnotationReplyRow, type DocumentAnnotationRow } from '@/lib/db/schema/document-annotations'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'
import {
  LIVE_ANNOTATION_STATUSES,
  MAX_ANNOTATIONS_PER_DOCUMENT,
  MAX_REPLIES_PER_ANNOTATION,
  type AnnotationAuthor,
  type AnnotationKind,
  type AnnotationShape,
  type AnnotationStatus,
  type MarkMention,
  type MarkTally,
} from './types'

export interface CarryLink {
  annotationId: string
  documentId: string
  number: number
}

export interface AnnotationRecord extends DocumentAnnotationRow {
  revisionNumber: number | null
  replies: DocumentAnnotationReplyRow[]
  carriedFrom?: CarryLink | null
  carriedTo?: CarryLink | null
}

export const carriedSource = alias(documentAnnotations, 'carried_source')
export const carriedCopy = alias(documentAnnotations, 'carried_copy')

export const selection = {
  row: documentAnnotations,
  revisionNumber: documentVersions.versionNumber,
  fromId: carriedSource.id,
  fromDocumentId: carriedSource.documentId,
  fromNumber: carriedSource.number,
  toId: carriedCopy.id,
  toDocumentId: carriedCopy.documentId,
  toNumber: carriedCopy.number,
}

export type SelectedRow = {
  row: DocumentAnnotationRow
  revisionNumber: number | null
  fromId: string | null
  fromDocumentId: string | null
  fromNumber: number | null
  toId: string | null
  toDocumentId: string | null
  toNumber: number | null
}

const linkOf = (id: string | null, documentId: string | null, number: number | null): CarryLink | null =>
  id && documentId && number !== null ? { annotationId: id, documentId, number: Number(number) } : null

async function listReplies(organizationId: string, annotationIds: readonly string[]) {
  if (annotationIds.length === 0) return new Map<string, DocumentAnnotationReplyRow[]>()
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(documentAnnotationReplies)
      .where(
        and(
          eq(documentAnnotationReplies.organizationId, organizationId),
          inArray(documentAnnotationReplies.annotationId, [...annotationIds])
        )
      )
      .orderBy(asc(documentAnnotationReplies.createdAt))
      .limit(annotationIds.length * MAX_REPLIES_PER_ANNOTATION)
  )
  const byAnnotation = new Map<string, DocumentAnnotationReplyRow[]>()
  for (const reply of rows) {
    const thread = byAnnotation.get(reply.annotationId) ?? []
    if (thread.length < MAX_REPLIES_PER_ANNOTATION) thread.push(reply)
    byAnnotation.set(reply.annotationId, thread)
  }
  return byAnnotation
}

export async function withThreads(organizationId: string, rows: SelectedRow[]): Promise<AnnotationRecord[]> {
  const threads = await listReplies(
    organizationId,
    rows.map(({ row }) => row.id)
  )
  return rows.map(({ row, revisionNumber, ...links }) => ({
    ...row,
    revisionNumber: revisionNumber === null ? null : Number(revisionNumber),
    replies: threads.get(row.id) ?? [],
    carriedFrom: linkOf(links.fromId, links.fromDocumentId, links.fromNumber),
    carriedTo: linkOf(links.toId, links.toDocumentId, links.toNumber),
  }))
}

export const carryJoins = (organizationId: string) => ({
  source: and(eq(carriedSource.id, documentAnnotations.carriedFromId), eq(carriedSource.organizationId, organizationId)),
  copy: and(eq(carriedCopy.carriedFromId, documentAnnotations.id), eq(carriedCopy.organizationId, organizationId)),
})

export async function listDocumentAnnotations(
  organizationId: string,
  documentId: string
): Promise<AnnotationRecord[]> {
  const db = getDb()
  const joins = carryJoins(organizationId)
  const rows = await withTenant({ organizationId }, () =>
    db
      .select(selection)
      .from(documentAnnotations)
      .leftJoin(documentVersions, eq(documentVersions.id, documentAnnotations.versionId))
      .leftJoin(carriedSource, joins.source)
      .leftJoin(carriedCopy, joins.copy)
      .where(
        and(
          eq(documentAnnotations.organizationId, organizationId),
          eq(documentAnnotations.documentId, documentId)
        )
      )
      .orderBy(asc(documentAnnotations.number))
      .limit(MAX_ANNOTATIONS_PER_DOCUMENT)
  )
  return withThreads(organizationId, rows)
}

export async function tallyLiveMarks(
  organizationId: string,
  documentIds: readonly string[],
  reader: DocumentReader,
  readerUserId: string
): Promise<Map<string, MarkTally>> {
  if (documentIds.length === 0) return new Map()
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({
        documentId: documentAnnotations.documentId,
        open: sql<number | string>`count(*) filter (where ${documentAnnotations.status} = 'open')`,
        proposed: sql<number | string>`count(*) filter (where ${documentAnnotations.status} = 'proposed')`,
        forYou: sql<number | string>`count(*) filter (where ${documentAnnotations.status} = 'open' and ${documentAnnotations.assigneeUserId} = ${readerUserId})`,
      })
      .from(documentAnnotations)
      .innerJoin(documents, eq(documents.id, documentAnnotations.documentId))
      .where(
        and(
          eq(documentAnnotations.organizationId, organizationId),
          eq(documents.organizationId, organizationId),
          inArray(documentAnnotations.documentId, [...documentIds]),
          inArray(documentAnnotations.status, [...LIVE_ANNOTATION_STATUSES]),
          documentVisibleTo(reader)
        )
      )
      .groupBy(documentAnnotations.documentId)
      .limit(documentIds.length)
  )
  return new Map(
    rows.map((row) => [
      row.documentId,
      { open: Number(row.open), proposed: Number(row.proposed), forYou: Number(row.forYou) },
    ])
  )
}

export async function findDocumentAnnotation(
  organizationId: string,
  documentId: string,
  annotationId: string
): Promise<AnnotationRecord | null> {
  const db = getDb()
  const joins = carryJoins(organizationId)
  const rows = await withTenant({ organizationId }, () =>
    db
      .select(selection)
      .from(documentAnnotations)
      .leftJoin(documentVersions, eq(documentVersions.id, documentAnnotations.versionId))
      .leftJoin(carriedSource, joins.source)
      .leftJoin(carriedCopy, joins.copy)
      .where(
        and(
          eq(documentAnnotations.organizationId, organizationId),
          eq(documentAnnotations.documentId, documentId),
          eq(documentAnnotations.id, annotationId)
        )
      )
      .limit(1)
  )
  const [record] = await withThreads(organizationId, rows)
  return record ?? null
}

export interface NewAnnotationValues {
  page: number
  shape: AnnotationShape
  x: number
  y: number
  w: number | null
  h: number | null
  kind: AnnotationKind
  body: string
  mentions?: MarkMention[]
  basis: string | null
  assigneeUserId: string | null
  dueOn: string | null
}

export interface NewAnnotationsInput {
  organizationId: string
  documentId: string
  versionId: string | null
  authorKind: AnnotationAuthor
  createdBy: string
  acceptedBy?: string | null
  marks: readonly NewAnnotationValues[]
}

export class AnnotationLimitReachedError extends Error {}

export async function insertDocumentAnnotations(input: NewAnnotationsInput): Promise<DocumentAnnotationRow[]> {
  const db = getDb()
  const acceptedBy = input.authorKind === 'piloti' ? (input.acceptedBy ?? null) : null
  const status: AnnotationStatus = input.authorKind === 'piloti' && !acceptedBy ? 'proposed' : 'open'
  const acceptance = acceptedBy ? { acceptedBy, acceptedAt: new Date() } : {}
  return withTenant({ organizationId: input.organizationId }, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`document_annotations:${input.documentId}`}, 0))`
      )
      const [current] = await tx
        .select({
          highest: sql<number | string | null>`max(${documentAnnotations.number})`,
          count: sql<number | string>`count(*)`,
        })
        .from(documentAnnotations)
        .where(
          and(
            eq(documentAnnotations.organizationId, input.organizationId),
            eq(documentAnnotations.documentId, input.documentId)
          )
        )
      if (Number(current?.count ?? 0) + input.marks.length > MAX_ANNOTATIONS_PER_DOCUMENT) {
        throw new AnnotationLimitReachedError()
      }
      const highest = current?.highest
      const first = highest === null || highest === undefined ? 1 : Number(highest) + 1
      return tx
        .insert(documentAnnotations)
        .values(
          input.marks.map((mark, index) => ({
            ...mark,
            organizationId: input.organizationId,
            documentId: input.documentId,
            versionId: input.versionId,
            authorKind: input.authorKind,
            createdBy: input.createdBy,
            status,
            ...acceptance,
            number: first + index,
          }))
        )
        .returning()
    })
  )
}

export class AlreadyCarriedError extends Error {}

export async function carryAnnotationToDocument(input: {
  organizationId: string
  source: DocumentAnnotationRow
  target: { documentId: string; versionId: string | null }
  values: Pick<NewAnnotationValues, 'mentions' | 'assigneeUserId'>
  closedBy: string
}): Promise<DocumentAnnotationRow | null> {
  const { organizationId, source, target } = input
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`document_annotations:${target.documentId}`}, 0))`
        )
        const [current] = await tx
          .select({
            highest: sql<number | string | null>`max(${documentAnnotations.number})`,
            count: sql<number | string>`count(*)`,
          })
          .from(documentAnnotations)
          .where(
            and(
              eq(documentAnnotations.organizationId, organizationId),
              eq(documentAnnotations.documentId, target.documentId)
            )
          )
        if (Number(current?.count ?? 0) + 1 > MAX_ANNOTATIONS_PER_DOCUMENT) throw new AnnotationLimitReachedError()
        const now = new Date()
        const [closed] = await tx
          .update(documentAnnotations)
          .set({ status: 'resolved', closedBy: input.closedBy, closedAt: now, updatedAt: now })
          .where(
            and(
              eq(documentAnnotations.organizationId, organizationId),
              eq(documentAnnotations.documentId, source.documentId),
              eq(documentAnnotations.id, source.id),
              eq(documentAnnotations.status, 'open'),
              isNull(documentAnnotations.delegatedBy)
            )
          )
          .returning({ id: documentAnnotations.id })
        if (!closed) return null
        const highest = current?.highest
        const [row] = await tx
          .insert(documentAnnotations)
          .values({
            organizationId,
            documentId: target.documentId,
            versionId: target.versionId,
            number: highest === null || highest === undefined ? 1 : Number(highest) + 1,
            page: source.page,
            shape: source.shape,
            x: source.x,
            y: source.y,
            w: source.w,
            h: source.h,
            kind: source.kind,
            body: source.body,
            mentions: input.values.mentions ?? [],
            basis: source.basis,
            authorKind: source.authorKind,
            status: 'open',
            assigneeUserId: input.values.assigneeUserId,
            dueOn: source.dueOn,
            createdBy: source.createdBy,
            acceptedBy: source.acceptedBy,
            acceptedAt: source.acceptedAt,
            carriedFromId: source.id,
          })
          .returning()
        return row
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'uniq_document_annotations_carried_from')) throw new AlreadyCarriedError()
        throw error
      })
  )
}

export interface AnnotationChanges {
  kind?: AnnotationKind
  body?: string
  mentions?: MarkMention[]
  basis?: string | null
  assigneeUserId?: string | null
  dueOn?: string | null
  transition?: {
    status: AnnotationStatus
    acceptedBy?: string
    acceptedAt?: Date
    closedBy: string | null
    closedAt: Date | null
  }
  delegation?: { delegatedBy: string; delegatedAt: Date } | { delegatedBy: null; delegatedAt: null }
  revision?: { from: string | null; to: string | null }
}

export type InTransaction<T> = (tx: DbTransaction, row: T) => Promise<void>

export async function updateDocumentAnnotation(
  organizationId: string,
  documentId: string,
  annotationId: string,
  expectedStatus: AnnotationStatus,
  changes: AnnotationChanges,
  afterUpdate?: InTransaction<DocumentAnnotationRow>
): Promise<DocumentAnnotationRow | null> {
  const { transition, delegation, revision: revision, ...fields } = changes
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(documentAnnotations)
        .set({
          ...fields,
          ...(transition ?? {}),
          ...(delegation ?? {}),
          ...(revision ? { versionId: revision.to } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documentAnnotations.organizationId, organizationId),
            eq(documentAnnotations.documentId, documentId),
            eq(documentAnnotations.id, annotationId),
            eq(documentAnnotations.status, expectedStatus),
            ...(revision ? [sql`${documentAnnotations.versionId} IS NOT DISTINCT FROM ${revision.from}`] : [])
          )
        )
        .returning()
      if (row && afterUpdate) await afterUpdate(tx, row)
      return row ?? null
    })
  )
}

export async function deleteDocumentAnnotation(
  organizationId: string,
  documentId: string,
  annotationId: string,
  beforeDelete?: (tx: DbTransaction) => Promise<void>
): Promise<boolean> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      await beforeDelete?.(tx)
      return tx
        .delete(documentAnnotations)
        .where(
          and(
            eq(documentAnnotations.organizationId, organizationId),
            eq(documentAnnotations.documentId, documentId),
            eq(documentAnnotations.id, annotationId)
          )
        )
        .returning({ id: documentAnnotations.id })
    })
  )
  return rows.length > 0
}

export class ReplyLimitReachedError extends Error {}

export async function insertAnnotationReply(
  input: {
    organizationId: string
    annotationId: string
    authorKind: AnnotationAuthor
    body: string
    createdBy: string
    addressesAgent?: boolean
    mentions?: MarkMention[]
  },
  afterInsert?: InTransaction<DocumentAnnotationReplyRow>
): Promise<DocumentAnnotationReplyRow> {
  const db = getDb()
  return withTenant({ organizationId: input.organizationId }, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`document_annotation_replies:${input.annotationId}`}, 0))`
      )
      const [current] = await tx
        .select({ count: sql<number | string>`count(*)` })
        .from(documentAnnotationReplies)
        .where(
          and(
            eq(documentAnnotationReplies.organizationId, input.organizationId),
            eq(documentAnnotationReplies.annotationId, input.annotationId)
          )
        )
      if (Number(current?.count ?? 0) >= MAX_REPLIES_PER_ANNOTATION) throw new ReplyLimitReachedError()
      const [reply] = await tx.insert(documentAnnotationReplies).values(input).returning()
      await tx
        .update(documentAnnotations)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(documentAnnotations.organizationId, input.organizationId),
            eq(documentAnnotations.id, input.annotationId)
          )
        )
      if (afterInsert) await afterInsert(tx, reply)
      return reply
    })
  )
}

export async function deleteAnnotationReply(
  organizationId: string,
  annotationId: string,
  replyId: string,
  expectedBody?: string
): Promise<boolean> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .delete(documentAnnotationReplies)
      .where(
        and(
          eq(documentAnnotationReplies.organizationId, organizationId),
          eq(documentAnnotationReplies.annotationId, annotationId),
          eq(documentAnnotationReplies.id, replyId),
          ...(expectedBody === undefined ? [] : [eq(documentAnnotationReplies.body, expectedBody)])
        )
      )
      .returning({ id: documentAnnotationReplies.id })
  )
  return rows.length > 0
}

export async function updateAnnotationReply(
  organizationId: string,
  annotationId: string,
  replyId: string,
  expectedBody: string,
  changes: { body: string; mentions: MarkMention[] }
): Promise<DocumentAnnotationReplyRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(documentAnnotationReplies)
      .set({ body: changes.body, mentions: changes.mentions, editedAt: sql`now()` })
      .where(
        and(
          eq(documentAnnotationReplies.organizationId, organizationId),
          eq(documentAnnotationReplies.annotationId, annotationId),
          eq(documentAnnotationReplies.id, replyId),
          eq(documentAnnotationReplies.body, expectedBody)
        )
      )
      .returning()
  )
  return row ?? null
}
