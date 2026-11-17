import 'server-only'
import { and, asc, eq, gt, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentAnnotations } from '@/lib/db/schema/document-annotations'
import { documents } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import type { OpenableDocument } from '@/lib/documents/may-open'
import { documentVisibleTo } from '@/lib/documents/visibility'

export interface DueMark {
  id: string
  documentId: string
  number: number
  body: string
  assigneeUserId: string
  dueOn: string
  document: OpenableDocument & { id: string }
}

export interface DueWindow {
  from: string
  through: string
}

const dueWithin = (window: DueWindow) =>
  and(
    eq(documentAnnotations.status, 'open'),
    isNotNull(documentAnnotations.assigneeUserId),
    isNotNull(documentAnnotations.dueOn),
    gte(documentAnnotations.dueOn, window.from),
    lte(documentAnnotations.dueOn, window.through),
    eq(documents.lifecycle, 'active'),
    inArray(documents.scope, ['project', 'office_shelf']),
    documentVisibleTo(SCREENED_ONLY)
  )

const onItsDocument = and(
  eq(documents.id, documentAnnotations.documentId),
  eq(documents.organizationId, documentAnnotations.organizationId)
)

export async function listOrganizationsWithDueMarks(window: DueWindow, day: string, limit: number): Promise<string[]> {
  const rows = await getDb()
    .select({ organizationId: documentAnnotations.organizationId })
    .from(documentAnnotations)
    .innerJoin(documents, onItsDocument)
    .where(dueWithin(window))
    .groupBy(documentAnnotations.organizationId)
    .orderBy(sql`md5(${documentAnnotations.organizationId} || ${day})`, asc(documentAnnotations.organizationId))
    .limit(limit)
  return rows.map((row) => row.organizationId)
}

export async function listDueMarksPage(
  organizationId: string,
  window: DueWindow,
  after: string | null,
  limit: number
): Promise<DueMark[]> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({
        id: documentAnnotations.id,
        documentId: documentAnnotations.documentId,
        number: documentAnnotations.number,
        body: documentAnnotations.body,
        assigneeUserId: documentAnnotations.assigneeUserId,
        dueOn: documentAnnotations.dueOn,
        scope: documents.scope,
        projectId: documents.projectId,
        folderId: documents.folderId,
        createdBy: documents.createdBy,
        status: documents.status,
        authoredBy: documents.authoredBy,
        screeningOutcome: documents.screeningOutcome,
        contentHash: documents.contentHash,
        screenedHash: documents.screenedHash,
      })
      .from(documentAnnotations)
      .innerJoin(documents, onItsDocument)
      .where(
        and(
          eq(documentAnnotations.organizationId, organizationId),
          dueWithin(window),
          after ? gt(documentAnnotations.id, after) : undefined
        )
      )
      .orderBy(asc(documentAnnotations.id))
      .limit(limit)
  )
  return rows.flatMap(({ id, documentId, number, body, assigneeUserId, dueOn, ...document }) =>
    assigneeUserId && dueOn
      ? [{ id, documentId, number: Number(number), body, assigneeUserId, dueOn, document: { ...document, id: documentId } }]
      : []
  )
}
