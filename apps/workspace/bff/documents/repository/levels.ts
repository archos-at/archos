import 'server-only'
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { type DocumentShelf } from '../shelf'
import { type DocumentLevelCursor, type DocumentLevelSort } from '../list-cursor'
import type { DocumentLevelQuery } from '../list-query'
import { DOCUMENT_READ_FAMILIES, declaredStatusesIn, type DocumentReadFamily } from '../document-status'
import { documents } from '@/lib/db/schema/documents'
import { boundListLimit, cursorCreatedAtColumn, documentListColumns, type DocumentListRow, listingWhere, type ListProjectDocumentsOptions } from './list'

export type ShelfReadFilters = Pick<ListProjectDocumentsOptions, 'authoredBy' | 'includeArchived' | 'hiddenFolderIds' | 'reader'>

export interface DocumentLevelPage {
  rows: DocumentListRow[]
  nextCursor: DocumentLevelCursor | null
}

function levelSortKey(sort: DocumentLevelSort): SQL {
  switch (sort) {
    case 'added':
      return sql`${documents.createdAt}`
    case 'name':
      return sql`lower(coalesce(${documents.displayName}, ${documents.filename}))`
    case 'size':
      return sql`coalesce(${documents.fileSize}, -1)`
  }
}

function levelCursorValueColumn(sort: DocumentLevelSort): SQL<string> {
  switch (sort) {
    case 'added':
      return cursorCreatedAtColumn
    case 'name':
      return sql<string>`lower(coalesce(${documents.displayName}, ${documents.filename}))`
    case 'size':
      return sql<string>`coalesce(${documents.fileSize}, -1)::text`
  }
}

function levelCursorBound(cursor: DocumentLevelCursor): SQL {
  switch (cursor.sort) {
    case 'added':
      return sql`(${cursor.value}::timestamp AT TIME ZONE 'UTC')`
    case 'name':
      return sql`${cursor.value}::text`
    case 'size':
      return sql`${cursor.value}::integer`
  }
}

export function afterDocumentLevelCursor(cursor: DocumentLevelCursor): SQL {
  const key = levelSortKey(cursor.sort)
  const bound = levelCursorBound(cursor)
  const past = cursor.dir === 'asc' ? sql`${key} > ${bound}` : sql`${key} < ${bound}`
  return sql`(${past} OR (${key} = ${bound} AND ${documents.id} > ${cursor.id}::uuid))`
}

export function nameContains(q: string | undefined): SQL | undefined {
  const needle = q?.trim() ?? ''
  if (needle === '') return undefined
  return or(
    sql`strpos(fold_german(${documents.filename}), fold_german(${needle})) > 0`,
    sql`strpos(fold_german(coalesce(${documents.displayName}, '')), fold_german(${needle})) > 0`,
  )
}

export function readFamilyWhere(states: readonly DocumentReadFamily[] | undefined): SQL | undefined {
  const wanted = [...new Set(states ?? [])]
  if (wanted.length === 0 || wanted.length === DOCUMENT_READ_FAMILIES.length) return undefined
  const lowered = sql`lower(${documents.status})`
  const declaredElsewhere = DOCUMENT_READ_FAMILIES.filter((family) => family !== 'reading').flatMap(declaredStatusesIn)
  return or(
    ...wanted.map((family) =>
      family === 'reading' ? notInArray(lowered, declaredElsewhere) : inArray(lowered, declaredStatusesIn(family)),
    ),
  )
}

function levelWhere({ folderId, q, states, cursor }: DocumentLevelQuery): SQL[] {
  const where: SQL[] = []
  if (folderId !== undefined) where.push(folderId === null ? isNull(documents.folderId) : eq(documents.folderId, folderId))
  const named = nameContains(q)
  if (named) where.push(named)
  const family = readFamilyWhere(states)
  if (family) where.push(family)
  if (cursor) where.push(afterDocumentLevelCursor(cursor))
  return where
}

export function readDocumentLevelPage(
  fetched: Array<DocumentListRow & { cursorValue: string }>,
  level: Pick<DocumentLevelQuery, 'sort' | 'dir'>,
  limit: number,
): DocumentLevelPage {
  const bounded = boundListLimit(limit)
  const hasMore = fetched.length > bounded
  const page = hasMore ? fetched.slice(0, bounded) : fetched
  const rows = page.map(({ cursorValue: _cursor, ...row }) => ({
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }))
  const last = page.at(-1)
  return {
    rows,
    nextCursor:
      hasMore && last ? { sort: level.sort, dir: level.dir, value: String(last.cursorValue), id: last.id } : null,
  }
}

export async function listDocumentLevelPage(
  shelf: DocumentShelf,
  organizationId: string,
  { level, ...filters }: ShelfReadFilters & { level: DocumentLevelQuery },
): Promise<DocumentLevelPage> {
  const db = getDb()
  const bounded = boundListLimit(level.limit)
  const key = levelSortKey(level.sort)
  const fetched = await withTenant({ organizationId }, () =>
    db
      .select({ ...documentListColumns, cursorValue: levelCursorValueColumn(level.sort) })
      .from(documents)
      .where(and(listingWhere(shelf, organizationId, filters), ...levelWhere(level)))
      .orderBy(level.dir === 'asc' ? asc(key) : desc(key), asc(documents.id))
      .limit(bounded + 1),
  )
  return readDocumentLevelPage(fetched, level, bounded)
}
