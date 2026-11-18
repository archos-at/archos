import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'

export async function setDocumentLifecycle(
  documentId: string,
  organizationId: string,
  lifecycle: 'active' | 'archived',
): Promise<void> {
  const db = getDb()
  await db
    .update(documents)
    .set({ lifecycle, updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
}
