import 'server-only'
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { projectShelf, shelfDocumentWhere, type DocumentShelf } from '../shelf'
import { documentAliasKey, documentNameVariants } from '../name-match'
import { FILENAME_LOOKUP_MAX_NAMES } from '../filename-lookup'
import { documents, type DocumentAuthor, type DocumentLifecycle } from '@/lib/db/schema/documents'
import { documentVisibleTo, type DocumentReader } from '../visibility'
import { DOCUMENT_LIST_LIMIT, type ListProjectDocumentsOptions, outsideHiddenFolders } from './list'

export interface RevisionCounterpartRow {
  id: string
  filename: string
  projectId: string | null
  folderId: string | null
  createdAt: Date | null
}

export async function findRevisionCounterparts(
  organizationId: string,
  collectionName: string,
  filenames: readonly string[],
  reader: DocumentReader,
): Promise<RevisionCounterpartRow[]> {
  const unique = [...new Set(filenames)]
  const byId = new Map<string, RevisionCounterpartRow>()
  for (let start = 0; start < unique.length; start += FILENAME_LOOKUP_MAX_NAMES) {
    const chunk = unique.slice(start, start + FILENAME_LOOKUP_MAX_NAMES)
    for (const row of await findRevisionCounterpartChunk(organizationId, collectionName, chunk, reader)) byId.set(row.id, row)
  }
  return [...byId.values()]
}

async function findRevisionCounterpartChunk(
  organizationId: string,
  collectionName: string,
  filenames: readonly string[],
  reader: DocumentReader,
): Promise<RevisionCounterpartRow[]> {
  const variants = [...new Set(filenames.flatMap(documentNameVariants))]
  if (variants.length === 0) return []
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select({
        id: documents.id,
        filename: documents.filename,
        projectId: documents.projectId,
        folderId: documents.folderId,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.collectionName, collectionName),
          inArray(documents.filename, variants),
          eq(documents.authoredBy, 'user'),
          eq(documents.lifecycle, 'active'),
          documentVisibleTo(reader),
        ),
      )
      .orderBy(asc(documents.id))
      .limit(DOCUMENT_LIST_LIMIT),
  )
}

export interface DocumentNameMatchRow {
  id: string
  filename: string
  displayName: string | null
  fileSize: number | null
  contentHash: string | null
  status: string
  folderId: string | null
  authoredBy: DocumentAuthor
  lifecycle: DocumentLifecycle
}

export const documentNameMatchColumns = {
  id: documents.id,
  filename: documents.filename,
  displayName: documents.displayName,
  fileSize: documents.fileSize,
  contentHash: documents.contentHash,
  status: documents.status,
  folderId: documents.folderId,
  authoredBy: documents.authoredBy,
  lifecycle: documents.lifecycle,
}

const NAME_PROBE_CHUNK = 500
const NAME_PROBE_ROW_LIMIT = NAME_PROBE_CHUNK * 4

function nameProbeWhere(names: readonly string[]): SQL | undefined {
  const exact = [...new Set(names.flatMap(documentNameVariants))]
  const folded = [...new Set(names.flatMap((name) => documentNameVariants(documentAliasKey(name))))]
  return and(
    eq(documents.authoredBy, 'user'),
    or(
      inArray(documents.filename, exact),
      inArray(sql`lower(${documents.filename})`, folded),
      inArray(sql`lower(${documents.displayName})`, folded),
    ),
  )
}

export async function probeDocumentNames(
  names: readonly string[],
  query: (where: SQL | undefined, limit: number) => Promise<DocumentNameMatchRow[]>,
): Promise<DocumentNameMatchRow[]> {
  const byId = new Map<string, DocumentNameMatchRow>()
  const unique = [...new Set(names)]
  for (let start = 0; start < unique.length; start += NAME_PROBE_CHUNK) {
    const rows = await query(nameProbeWhere(unique.slice(start, start + NAME_PROBE_CHUNK)), NAME_PROBE_ROW_LIMIT)
    for (const row of rows) byId.set(row.id, row)
  }
  return [...byId.values()]
}

export async function findDocumentsByNames(
  shelf: DocumentShelf,
  organizationId: string,
  names: readonly string[],
  { hiddenFolderIds, reader }: Pick<ListProjectDocumentsOptions, 'hiddenFolderIds' | 'reader'>,
): Promise<DocumentNameMatchRow[]> {
  const db = getDb()
  return probeDocumentNames(names, (where, limit) =>
    withTenant({ organizationId }, () =>
      db
        .select(documentNameMatchColumns)
        .from(documents)
        .where(
          and(
            shelfDocumentWhere(shelf, organizationId),
            ...outsideHiddenFolders(hiddenFolderIds),
            documentVisibleTo(reader),
            where,
          ),
        )
        .orderBy(desc(documents.createdAt), asc(documents.id))
        .limit(limit),
    ),
  )
}

export function findProjectDocumentsByNames(
  projectId: string,
  organizationId: string,
  names: readonly string[],
  options: Pick<ListProjectDocumentsOptions, 'hiddenFolderIds' | 'reader'>,
): Promise<DocumentNameMatchRow[]> {
  return findDocumentsByNames(projectShelf(projectId), organizationId, names, options)
}
