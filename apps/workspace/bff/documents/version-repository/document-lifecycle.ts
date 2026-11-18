import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersions } from '@/lib/db/schema/document-versions'
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

export const MAX_CHANGE_NOTE_CHARS = 500

export async function setVersionChangeNote(versionId: string, organizationId: string, note: string): Promise<void> {
  const db = getDb()
  await db
    .update(documentVersions)
    .set({ changeNote: note.slice(0, MAX_CHANGE_NOTE_CHARS) })
    .where(and(eq(documentVersions.id, versionId), eq(documentVersions.organizationId, organizationId)))
}
