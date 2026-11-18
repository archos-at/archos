import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents, type Document } from '@/lib/db/schema/documents'
import {
  findDocumentsByFilenames,
  findDocumentsByNames,
  listDocumentLevelPage,
  type DocumentLevelPage,
  type DocumentListRow,
  type DocumentNameMatchRow,
} from '@/lib/documents/repository'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'

export function listOfficeShelfDocumentLevel(
  organizationId: string,
  options: Parameters<typeof listDocumentLevelPage>[2],
): Promise<DocumentLevelPage> {
  return listDocumentLevelPage(OFFICE_SHELF, organizationId, options)
}

export function findOfficeShelfDocumentsByFilenames(
  organizationId: string,
  filenames: readonly string[],
  options: Parameters<typeof findDocumentsByFilenames>[3],
): Promise<DocumentListRow[]> {
  return findDocumentsByFilenames(OFFICE_SHELF, organizationId, filenames, options)
}

export function findOfficeShelfDocumentsByNames(
  organizationId: string,
  names: readonly string[],
  options: Parameters<typeof findDocumentsByNames>[3],
): Promise<DocumentNameMatchRow[]> {
  return findDocumentsByNames(OFFICE_SHELF, organizationId, names, options)
}

export async function findOfficeShelfDocument(
  documentId: string,
  organizationId: string,
  reader: DocumentReader,
): Promise<Document | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organizationId, organizationId),
        eq(documents.scope, 'office_shelf'),
        documentVisibleTo(reader),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function deleteOfficeShelfDocument(documentId: string, organizationId: string): Promise<void> {
  const db = getDb()
  await db
    .delete(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organizationId, organizationId),
        eq(documents.scope, 'office_shelf'),
      ),
    )
}
