import 'server-only'
import { and, asc, eq, gte, inArray, lt, lte, not, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentAnnotations } from '@/lib/db/schema/document-annotations'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents, type Document } from '@/lib/db/schema/documents'
import { withTenant } from '@/lib/db/tenant-context'
import { outsideHiddenFolders } from '@/lib/documents/repository'
import { projectShelf, shelfDocumentWhere } from '@/lib/documents/shelf'
import { documentVisibleTo, SCREENED_ONLY, type DocumentReader } from '@/lib/documents/visibility'
import { MAX_PROJECT_MARKS_PAGE, type ProjectMarkOrder } from './project-types'
import {
  carriedCopy,
  carriedSource,
  carryJoins,
  selection,
  withThreads,
  type AnnotationRecord,
} from './repository'
import type { AnnotationStatus } from './types'

export const NO_DUE_DATE = '9999-12-31'

export interface ProjectMarkCursor {
  due: string
  name: string
  documentId: string
  number: number
}

export type DueRange = { before: string } | { from: string; through: string }

export interface ProjectAnnotationPageQuery {
  reader: DocumentReader
  hiddenFolderIds: readonly string[]
  statuses: readonly AnnotationStatus[]
  assigneeUserId?: string | null
  due?: DueRange | null
  order: ProjectMarkOrder
  cursor: ProjectMarkCursor | null
  limit: number
}

export interface ProjectAnnotationRecord extends AnnotationRecord {
  document: Document
}

export interface ProjectAnnotationPage {
  records: ProjectAnnotationRecord[]
  next: ProjectMarkCursor | null
}

const nameKey = sql<string>`lower(coalesce(${documents.displayName}, ${documents.filename}))`
const dueKey = sql`coalesce(${documentAnnotations.dueOn}, ${NO_DUE_DATE}::date)`

function orderBy(order: ProjectMarkOrder): SQL[] {
  const byDocument = [asc(nameKey), asc(documents.id), asc(documentAnnotations.number)]
  return order === 'due' ? [asc(dueKey), ...byDocument] : byDocument
}

function after(order: ProjectMarkOrder, cursor: ProjectMarkCursor): SQL {
  const byDocument = sql`${nameKey}, ${documents.id}, ${documentAnnotations.number}`
  const bound = sql`${cursor.name}::text, ${cursor.documentId}::uuid, ${cursor.number}::integer`
  return order === 'due'
    ? sql`(${dueKey}, ${byDocument}) > (${cursor.due}::date, ${bound})`
    : sql`(${byDocument}) > (${bound})`
}

function dueWhere(due: DueRange | null | undefined): SQL[] {
  if (!due) return []
  if ('before' in due) return [lt(documentAnnotations.dueOn, due.before)]
  return [gte(documentAnnotations.dueOn, due.from), lte(documentAnnotations.dueOn, due.through)]
}

const clampLimit = (limit: number) => Math.min(Math.max(1, Math.trunc(limit)), MAX_PROJECT_MARKS_PAGE)

type SelectionQuery = Omit<ProjectAnnotationPageQuery, 'order' | 'cursor' | 'limit'>

function selectionWhere(organizationId: string, projectId: string, query: SelectionQuery): (SQL | undefined)[] {
  return [
    eq(documentAnnotations.organizationId, organizationId),
    shelfDocumentWhere(projectShelf(projectId), organizationId),
    eq(documents.lifecycle, 'active'),
    ...outsideHiddenFolders(query.hiddenFolderIds),
    documentVisibleTo(query.reader),
    inArray(documentAnnotations.status, [...query.statuses]),
    ...(query.assigneeUserId ? [eq(documentAnnotations.assigneeUserId, query.assigneeUserId)] : []),
    ...dueWhere(query.due),
  ]
}

export async function selectionReachesRestrictedDocuments(
  organizationId: string,
  projectId: string,
  query: SelectionQuery & { restrictedFolderIds: readonly string[] }
): Promise<boolean> {
  const db = getDb()
  const restricted = or(
    ...(query.restrictedFolderIds.length > 0 ? [inArray(documents.folderId, [...query.restrictedFolderIds])] : []),
    not(documentVisibleTo(SCREENED_ONLY) ?? sql`true`)
  )
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ id: documentAnnotations.id })
      .from(documentAnnotations)
      .innerJoin(documents, eq(documents.id, documentAnnotations.documentId))
      .where(and(...selectionWhere(organizationId, projectId, query), restricted))
      .limit(1)
  )
  return rows.length > 0
}

export async function listProjectAnnotationPage(
  organizationId: string,
  projectId: string,
  query: ProjectAnnotationPageQuery
): Promise<ProjectAnnotationPage> {
  const limit = clampLimit(query.limit)
  const db = getDb()
  const joins = carryJoins(organizationId)
  const rows = await withTenant({ organizationId }, () =>
    db
      .select({ ...selection, document: documents, sortName: nameKey })
      .from(documentAnnotations)
      .innerJoin(documents, eq(documents.id, documentAnnotations.documentId))
      .leftJoin(documentVersions, eq(documentVersions.id, documentAnnotations.versionId))
      .leftJoin(carriedSource, joins.source)
      .leftJoin(carriedCopy, joins.copy)
      .where(
        and(
          ...selectionWhere(organizationId, projectId, query),
          ...(query.cursor ? [after(query.order, query.cursor)] : [])
        )
      )
      .orderBy(...orderBy(query.order))
      .limit(limit + 1)
  )
  const page = rows.slice(0, limit)
  const records = (await withThreads(organizationId, page)).map((record, index) => ({
    ...record,
    document: page[index].document,
  }))
  const last = page.at(-1)
  const next =
    rows.length > limit && last
      ? {
          due: last.row.dueOn ?? NO_DUE_DATE,
          name: String(last.sortName),
          documentId: last.document.id,
          number: Number(last.row.number),
        }
      : null
  return { records, next }
}
