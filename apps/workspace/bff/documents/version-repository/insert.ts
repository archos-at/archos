import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersions, type DocumentVersion, type NewDocumentVersion } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { mapVersionInsertError } from '../unique-conflicts'
import type { Transaction } from './transaction'

export type NewDocumentVersionValues = Omit<NewDocumentVersion, 'versionNumber'>

export async function allocateVersionNumber(
  tx: Transaction,
  documentId: string,
  organizationId: string,
): Promise<number> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`document_versions:${documentId}`}, 0))`,
  )
  const [row] = await tx
    .select({ highest: sql<number | string | null>`max(${documentVersions.versionNumber})` })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.organizationId, organizationId),
      ),
    )
  return row?.highest === null || row?.highest === undefined ? 1 : Number(row.highest) + 1
}

export async function insertDocumentVersion(
  values: NewDocumentVersionValues,
): Promise<DocumentVersion> {
  const db = getDb()
  return db
    .transaction(async (tx) => {
      const versionNumber = await allocateVersionNumber(tx, values.documentId, values.organizationId)
      const [row] = await tx
        .insert(documentVersions)
        .values({ ...values, versionNumber })
        .returning()
      return row
    })
    .catch((error: unknown) => {
      throw mapVersionInsertError(error, values.documentId)
    })
}

export async function insertPublishedVersion(
  values: NewDocumentVersionValues,
): Promise<{ version: DocumentVersion; superseded: DocumentVersion[] }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const versionNumber = await allocateVersionNumber(tx, values.documentId, values.organizationId)
    const superseded = await tx
      .update(documentVersions)
      .set({ state: 'superseded', updatedAt: new Date() })
      .where(
        and(
          eq(documentVersions.documentId, values.documentId),
          eq(documentVersions.organizationId, values.organizationId),
          eq(documentVersions.state, 'published'),
        ),
      )
      .returning()

    const [version] = await tx
      .insert(documentVersions)
      .values({ ...values, versionNumber })
      .returning()

    await tx
      .update(documents)
      .set({
        publishedVersionId: version.id,
        storageKey: version.storageKey,
        storageBucket: version.storageBucket,
        contentType: version.contentType,
        fileSize: version.fileSize,
        contentHash: version.contentHash,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.id, values.documentId),
          eq(documents.organizationId, values.organizationId),
        ),
      )

    return { version, superseded }
  }).catch((error: unknown) => {
    throw mapVersionInsertError(error, values.documentId)
  })
}
