import 'server-only'
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersions, type DocumentVersion } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import type { DocumentVersionState } from '../lifecycle-vocabulary'
import { DOCUMENT_VERSION_STATES, OPEN_DOCUMENT_VERSION_STATES } from '../lifecycle-vocabulary'
import { documentVisibleTo, SCREENED_ONLY } from '../visibility'

export const DOCUMENT_VERSION_LIST_LIMIT = 500

export async function listDocumentVersions(
  documentId: string,
  organizationId: string,
): Promise<DocumentVersion[]> {
  const db = getDb()
  return db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.organizationId, organizationId),
      ),
    )
    .orderBy(asc(documentVersions.versionNumber))
    .limit(DOCUMENT_VERSION_LIST_LIMIT)
}

export async function findDocumentVersion(
  versionId: string,
  documentId: string,
  organizationId: string,
): Promise<DocumentVersion | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, versionId),
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.organizationId, organizationId),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function findPreviousVersion(
  documentId: string,
  organizationId: string,
  versionNumber: number,
): Promise<DocumentVersion | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.organizationId, organizationId),
        lt(documentVersions.versionNumber, versionNumber),
      ),
    )
    .orderBy(desc(documentVersions.versionNumber))
    .limit(1)
  return row ?? null
}

export async function findDocumentVersionInOrg(
  versionId: string,
  organizationId: string,
): Promise<DocumentVersion | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, versionId),
        eq(documentVersions.organizationId, organizationId),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function findPublishedVersion(
  documentId: string,
  organizationId: string,
): Promise<DocumentVersion | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.organizationId, organizationId),
        eq(documentVersions.state, 'published'),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function findOpenVersion(
  documentId: string,
  organizationId: string,
): Promise<DocumentVersion | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.organizationId, organizationId),
        inArray(documentVersions.state, [...OPEN_DOCUMENT_VERSION_STATES]),
      ),
    )
    .limit(1)
  return row ?? null
}

export interface DocumentVersionSummary {
  documentId: string
  versionCount: number
  state: DocumentVersionState
}

export async function listDocumentVersionSummaries(
  documentIds: readonly string[],
  organizationId: string,
): Promise<DocumentVersionSummary[]> {
  if (documentIds.length === 0) return []
  const db = getDb()
  const rows = await db
    .select({
      documentId: documentVersions.documentId,
      versionCount: sql<number>`count(*)`,
      newestState: sql<string>`(array_agg(${documentVersions.state} order by ${documentVersions.versionNumber} desc))[1]`,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.organizationId, organizationId),
        inArray(documentVersions.documentId, [...documentIds]),
      ),
    )
    .groupBy(documentVersions.documentId)
    .limit(DOCUMENT_VERSION_LIST_LIMIT)

  const known: readonly string[] = DOCUMENT_VERSION_STATES
  return rows.flatMap((row) =>
    known.includes(row.newestState)
      ? [
          {
            documentId: row.documentId,
            versionCount: Number(row.versionCount),
            state: row.newestState as DocumentVersionState,
          },
        ]
      : // A state this build has never heard of (a newer deploy, a rollback) is
        [],
  )
}

export async function nextVersionNumber(
  documentId: string,
  organizationId: string,
): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ highest: sql<number | null>`max(${documentVersions.versionNumber})` })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.organizationId, organizationId),
      ),
    )
  return row?.highest === null || row?.highest === undefined ? 1 : Number(row.highest) + 1
}

export async function listDocumentVersionObjects(
  documentId: string,
  organizationId: string,
): Promise<Array<Pick<DocumentVersion, 'storageKey' | 'storageBucket'>>> {
  const db = getDb()
  const objects = new Map<string, Pick<DocumentVersion, 'storageKey' | 'storageBucket'>>()
  for (let after = 0; ; ) {
    const page = await db
      .select({
        versionNumber: documentVersions.versionNumber,
        storageKey: documentVersions.storageKey,
        storageBucket: documentVersions.storageBucket,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.organizationId, organizationId),
          isNotNull(documentVersions.storageKey),
          gt(documentVersions.versionNumber, after),
        ),
      )
      .orderBy(asc(documentVersions.versionNumber))
      .limit(DOCUMENT_VERSION_LIST_LIMIT)
    for (const row of page) {
      objects.set(`${row.storageBucket ?? ''}\u0000${row.storageKey}`, {
        storageKey: row.storageKey,
        storageBucket: row.storageBucket,
      })
    }
    if (page.length < DOCUMENT_VERSION_LIST_LIMIT) return [...objects.values()]
    after = Number(page[page.length - 1].versionNumber)
  }
}

export async function listRefusedVersionsForConversation(
  conversationId: string,
  organizationId: string,
  limit: number,
): Promise<
  Array<{
    versionId: string
    documentId: string
    versionNumber: number
    state: DocumentVersionState
    reviewComment: string
    reviewedBy: string | null
    reviewedAt: Date | null
    displayName: string | null
    filename: string
  }>
> {
  const db = getDb()
  const rows = await db
    .select({
      versionId: documentVersions.id,
      documentId: documentVersions.documentId,
      versionNumber: documentVersions.versionNumber,
      state: documentVersions.state,
      reviewComment: documentVersions.reviewComment,
      reviewedBy: documentVersions.reviewedBy,
      reviewedAt: documentVersions.reviewedAt,
      displayName: documents.displayName,
      filename: documents.filename,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.originConversationId, conversationId),
        eq(documentVersions.organizationId, organizationId),
        inArray(documentVersions.state, ['changes_requested', 'rejected']),
        isNotNull(documentVersions.reviewComment),
        documentVisibleTo(SCREENED_ONLY),
      ),
    )
    .orderBy(desc(documentVersions.reviewedAt))
    .limit(limit)
  return rows.map((row) => ({
    ...row,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
    reviewComment: row.reviewComment ?? '',
  }))
}
