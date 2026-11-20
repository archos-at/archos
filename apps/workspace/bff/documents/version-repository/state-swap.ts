import 'server-only'
import { and, eq, ne } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersionReviews, documentVersions, type DocumentReviewOutcome, type DocumentSubmitActor, type DocumentVersion, type NewDocumentVersion } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import type { DocumentVersionState } from '../lifecycle-vocabulary'
import type { Transaction } from './transaction'

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
