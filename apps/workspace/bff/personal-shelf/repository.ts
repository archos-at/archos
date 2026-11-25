import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents, type Document } from '@/lib/db/schema/documents'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'

export async function findPersonalShelfDocument(
  documentId: string,
  organizationId: string,
  ownerUserId: string,
  reader: DocumentReader,
): Promise<Document | null> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organizationId, organizationId),
        eq(documents.scope, 'personal'),
        eq(documents.ownerUserId, ownerUserId),
        documentVisibleTo(reader),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function deletePersonalShelfDocumentRow(
  documentId: string,
  organizationId: string,
  ownerUserId: string,
): Promise<void> {
  await getDb()
    .delete(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.organizationId, organizationId),
        eq(documents.scope, 'personal'),
        eq(documents.ownerUserId, ownerUserId),
      ),
    )
}
