import 'server-only'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersionReviews, documentVersions, type DocumentReviewOutcome, type DocumentSubmitActor, type DocumentVersion, type NewDocumentVersion } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { inboxItems } from '@/lib/db/schema/inbox'
import { projects } from '@/lib/db/schema/projects'
import {
  lockStorageQuota,
  readStorageUsage,
  type DbTransaction,
} from '@/lib/storage/repository'
import type { DocumentVersionState } from './lifecycle-vocabulary'
import { DOCUMENT_VERSION_STATES, OPEN_DOCUMENT_VERSION_STATES } from './lifecycle-vocabulary'
import { mapVersionInsertError } from './unique-conflicts'
import { documentVisibleTo, SCREENED_ONLY, type ShelfReader } from './visibility'

export const DOCUMENT_VERSION_LIST_LIMIT = 500

export type NewDocumentVersionValues = Omit<NewDocumentVersion, 'versionNumber'>

type Transaction = DbTransaction

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

export interface ReviewQueueRow {
  documentId: string
  documentName: string
  projectId: string | null
  projectName: string | null
  folderId: string | null
  versionId: string
  versionNumber: number
  submittedBy: string | null
  submittedAt: Date | null
}

export async function listReviewQueue(
  organizationId: string,
  reader: ShelfReader,
  options: { role: 'reviewer' | 'submitter'; userId: string; projectId?: string; after?: string; limit: number }
): Promise<ReviewQueueRow[]> {
  const db = getDb()
  const waiting =
    options.role === 'reviewer'
      ? sql`exists (
          select 1 from ${inboxItems}
          where ${inboxItems.organizationId} = ${organizationId}
            and ${inboxItems.recipientUserId} = ${options.userId}
            and ${inboxItems.type} = 'document.review_requested'
            and ${inboxItems.actionable} = true
            and ${inboxItems.resolvedAt} is null
            and ${inboxItems.inertAt} is null
            and ${inboxItems.resourceId} = ${documentVersions.documentId}::text
            and ${inboxItems.anchorId} = ${documentVersions.id}::text
        )`
      : eq(documentVersions.submittedBy, options.userId)
  const after = options.after
    ? sql`(${documentVersions.submittedAt}, ${documentVersions.id}) < (select v.submitted_at, v.id from document_versions v where v.id = ${options.after}::uuid and v.organization_id = ${organizationId})`
    : undefined
  return db
    .select({
      documentId: documents.id,
      documentFilename: documents.filename,
      documentDisplayName: documents.displayName,
      projectId: documents.projectId,
      projectName: projects.name,
      folderId: documents.folderId,
      versionId: documentVersions.id,
      versionNumber: documentVersions.versionNumber,
      submittedBy: documentVersions.submittedBy,
      submittedAt: documentVersions.submittedAt,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .leftJoin(projects, eq(projects.id, documents.projectId))
    .where(
      and(
        eq(documentVersions.organizationId, organizationId),
        eq(documentVersions.state, 'in_review'),
        waiting,
        options.projectId ? eq(documents.projectId, options.projectId) : undefined,
        after,
        sql`(${documents.projectId} is not null or ${documents.scope} = 'office_shelf')`,
        documentVisibleTo(reader)
      )
    )
    .orderBy(desc(documentVersions.submittedAt), desc(documentVersions.id))
    .limit(options.limit + 1)
    .then((rows) =>
      rows.map((row) => ({
        documentId: row.documentId,
        documentName: row.documentDisplayName?.trim() ? row.documentDisplayName.trim() : row.documentFilename,
        projectId: row.projectId,
        projectName: row.projectName,
        folderId: row.folderId,
        versionId: row.versionId,
        versionNumber: row.versionNumber,
        submittedBy: row.submittedBy,
        submittedAt: row.submittedAt,
      }))
    )
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

export async function compareAndSwapVersionState(
  versionId: string,
  organizationId: string,
  expected: DocumentVersionState,
  patch: Partial<Omit<NewDocumentVersion, 'id' | 'organizationId' | 'documentId'>>,
  review?: ReviewRoundWrite,
): Promise<DocumentVersion | null> {
  const db = getDb()
  const swap = (tx: Pick<Transaction, 'update'>) =>
    tx
      .update(documentVersions)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(documentVersions.id, versionId),
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.state, expected),
        ),
      )
      .returning()
  if (!review) {
    const [row] = await swap(db)
    return row ?? null
  }
  try {
    return await db.transaction(async (tx) => {
      const [row] = await swap(tx)
      if (!row) throw new LostCompareAndSwap()
      await writeReviewRound(tx, row, review)
      return row
    })
  } catch (error) {
    if (error instanceof LostCompareAndSwap) return null
    throw error
  }
}

export type ReviewRoundWrite =
  | {
      kind: 'open'
      requestedBy: string
      requestedByActor: DocumentSubmitActor
      reviewerUserIds: readonly string[]
    }
  | {
      kind: 'decide'
      outcome: Exclude<DocumentReviewOutcome, 'requested'>
      decidedBy: string
      comment: string | null
    }

async function writeReviewRound(tx: Transaction, version: DocumentVersion, review: ReviewRoundWrite): Promise<void> {
  const now = new Date()
  const keys = { organizationId: version.organizationId, documentId: version.documentId, versionId: version.id }
  if (review.kind === 'open') {
    await tx
      .insert(documentVersionReviews)
      .values({
        ...keys,
        requestedBy: review.requestedBy,
        requestedByActor: review.requestedByActor,
        requestedAt: now,
        reviewerUserIds: [...review.reviewerUserIds],
      })
      .onConflictDoNothing()
    return
  }
  const decision = { outcome: review.outcome, decidedBy: review.decidedBy, decidedAt: now, comment: review.comment }
  const decided = await tx
    .update(documentVersionReviews)
    .set(decision)
    .where(and(eq(documentVersionReviews.versionId, version.id), eq(documentVersionReviews.outcome, 'requested')))
    .returning({ id: documentVersionReviews.id })
  if (decided.length > 0) return
  await tx.insert(documentVersionReviews).values({
    ...keys,
    requestedBy: version.submittedBy ?? review.decidedBy,
    requestedByActor: version.submittedByActor ?? 'human',
    requestedAt: version.submittedAt ?? now,
    ...decision,
  })
}

export class LostCompareAndSwap extends Error {
  constructor() {
    super('compare-and-swap matched no row')
    this.name = 'LostCompareAndSwap'
  }
}

export async function promoteVersionToPublished(
  versionId: string,
  documentId: string,
  organizationId: string,
  expected: DocumentVersionState,
  patch: Partial<Omit<NewDocumentVersion, 'id' | 'organizationId' | 'documentId'>> = {},
  review?: ReviewRoundWrite,
): Promise<{ version: DocumentVersion; superseded: DocumentVersion[] } | null> {
  const db = getDb()
  try {
    return await db.transaction(async (tx) => {
      const superseded = await tx
        .update(documentVersions)
        .set({ state: 'superseded', updatedAt: new Date() })
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.organizationId, organizationId),
            eq(documentVersions.state, 'published'),
            ne(documentVersions.id, versionId),
          ),
        )
        .returning()

      const [swapped] = await tx
        .update(documentVersions)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.organizationId, organizationId),
            eq(documentVersions.state, expected),
          ),
        )
        .returning()

      if (!swapped) throw new LostCompareAndSwap()
      if (review) await writeReviewRound(tx, swapped, review)

      await tx
        .update(documents)
        .set({
          publishedVersionId: swapped.id,
          storageKey: swapped.storageKey,
          storageBucket: swapped.storageBucket,
          contentType: swapped.contentType,
          fileSize: swapped.fileSize,
          contentHash: swapped.contentHash,
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))

      return { version: swapped, superseded }
    })
  } catch (error) {
    if (error instanceof LostCompareAndSwap) return null
    throw error
  }
}

export type VersionStorageColumns = Pick<
  DocumentVersion,
  'storageKey' | 'storageBucket' | 'contentType' | 'fileSize' | 'contentHash'
>

export interface ExpectedVersionContent {
  state: DocumentVersionState
  storageKey: string
  contentHash: string | null
}

export interface SwapVersionContentInput {
  versionId: string
  documentId: string
  organizationId: string
  expected: ExpectedVersionContent
  patch: Partial<Omit<NewDocumentVersion, 'id' | 'organizationId' | 'documentId'>> &
    VersionStorageColumns
  mirrorsItem: boolean
  quotaBytes: number | null
}

export type SwapVersionContentOutcome =
  | {
      ok: true
      version: DocumentVersion
      previousKeyOrphaned: boolean
    }
  | { ok: false; reason: 'conflict' }
  | { ok: false; reason: 'quota'; usedBytes: number }

class OverQuota extends Error {
  constructor(readonly usedBytes: number) {
    super('storage quota exceeded')
    this.name = 'OverQuota'
  }
}

export async function swapVersionContent(
  input: SwapVersionContentInput,
): Promise<SwapVersionContentOutcome> {
  const db = getDb()
  const { versionId, documentId, organizationId, expected, patch, quotaBytes } = input
  try {
    return await db.transaction(async (tx) => {
      await lockStorageQuota(tx, organizationId)
      const usedBefore = quotaBytes === null ? 0 : await readStorageUsage(tx, organizationId)

      const [version] = await tx
        .update(documentVersions)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.organizationId, organizationId),
            eq(documentVersions.state, expected.state),
            eq(documentVersions.storageKey, expected.storageKey),
            expected.contentHash === null
              ? isNull(documentVersions.contentHash)
              : eq(documentVersions.contentHash, expected.contentHash),
          ),
        )
        .returning()
      if (!version) throw new LostCompareAndSwap()

      if (input.mirrorsItem) {
        await tx
          .update(documents)
          .set({
            storageKey: version.storageKey,
            storageBucket: version.storageBucket,
            contentType: version.contentType,
            fileSize: version.fileSize,
            contentHash: version.contentHash,
            updatedAt: new Date(),
          })
          .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
      }

      if (quotaBytes !== null) {
        const usedAfter = await readStorageUsage(tx, organizationId)
        if (usedAfter > quotaBytes && usedAfter > usedBefore) throw new OverQuota(usedBefore)
      }

      const previousKeyOrphaned = await keyIsUnnamed(
        tx,
        documentId,
        organizationId,
        expected.storageKey,
      )
      return { ok: true as const, version, previousKeyOrphaned }
    })
  } catch (error) {
    if (error instanceof LostCompareAndSwap) return { ok: false, reason: 'conflict' }
    if (error instanceof OverQuota) {
      return { ok: false, reason: 'quota', usedBytes: error.usedBytes }
    }
    throw error
  }
}

async function keyIsUnnamed(
  tx: Transaction,
  documentId: string,
  organizationId: string,
  storageKey: string,
): Promise<boolean> {
  const rows = await tx.execute<{ named: boolean | string }>(sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM document_versions v
        WHERE v.document_id = ${documentId}
          AND v.organization_id = ${organizationId}
          AND v.storage_key = ${storageKey}
      )
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = ${documentId}
          AND d.organization_id = ${organizationId}
          AND d.storage_key = ${storageKey}
      )
    ) AS named
  `)
  const named = Array.from(rows)[0]?.named
  return !(named === true || named === 't')
}

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
