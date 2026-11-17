import 'server-only'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbTransaction } from '@/lib/db/executor'
import { withTenant } from '@/lib/db/tenant-context'
import { type DocumentStatus } from '../document-status'
import { documentQuarantineDecisions } from '@/lib/db/schema/document-quarantine-decisions'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import type { DocumentScreeningOutcome } from '@/lib/db/schema/documents'
import { auditedQuarantineReasons, storedQuarantineVerdictOf, type StoredQuarantineVerdict } from '@/lib/upload-screening/quarantine'
import { heldAtRest } from '../visibility'
import { verdictPasses } from '../document-reader'
import { type IngestFailureFacts } from '../retry-policy'

export interface ReconciledFrom {
  status: string
  jobId: string | null
}

export const sameDispatch = (jobId: string | null): SQL =>
  jobId
    ? sql`${documents.metadata} ->> 'ingestJobId' = ${jobId}`
    : sql`(${documents.metadata} ->> 'ingestJobId') IS NULL`

const screenedHashOfDispatch = sql<string | null>`coalesce(${documents.metadata} ->> 'ingestContentHash', ${documents.screenedHash})`

export const dispatchedHash = sql<string | null>`${documents.metadata} ->> 'ingestContentHash'`

async function recordVersionVerdict(
  tx: DbTransaction,
  documentId: string,
  organizationId: string,
  verdict: { judgedHash: string | null; passed: boolean },
): Promise<void> {
  if (!verdict.judgedHash) return
  await tx
    .update(documentVersions)
    .set({ screenedHash: verdict.passed ? verdict.judgedHash : null })
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.organizationId, organizationId),
        eq(documentVersions.contentHash, verdict.judgedHash),
      ),
    )
}

export async function setDocumentReconciledStatus(
  documentId: string,
  organizationId: string,
  resolution: {
    status: DocumentStatus
    errorMessage: string | null
    screeningOutcome?: DocumentScreeningOutcome
    quarantine?: StoredQuarantineVerdict | null
    failure?: IngestFailureFacts
  },
  from: ReconciledFrom,
): Promise<boolean> {
  const { failure } = resolution
  const verdict = resolution.status === 'quarantined' ? storedQuarantineVerdictOf(resolution) : null
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      const [moved] = await tx
        .update(documents)
        .set({
          status: resolution.status,
          errorMessage: resolution.errorMessage,
          quarantine: verdict,
          ...(resolution.screeningOutcome ? { screeningOutcome: resolution.screeningOutcome } : {}),
          ...(resolution.status === 'completed' ? { screenedHash: screenedHashOfDispatch } : {}),
          ...(failure
            ? {
                ingestFailureCategory: failure.category,
                ingestRetryable: failure.retryable,
                ingestReaderVersion: failure.readerVersion,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.organizationId, organizationId),
            sql`${documents.status} = ${from.status}`,
            sameDispatch(from.jobId),
          ),
        )
        .returning({
          scope: documents.scope,
          projectId: documents.projectId,
          folderId: documents.folderId,
          filename: documents.filename,
          createdBy: documents.createdBy,
          status: documents.status,
          screeningOutcome: documents.screeningOutcome,
          screenedHash: documents.screenedHash,
          dispatchedHash,
        })
      if (!moved) return false
      if (resolution.status !== 'failed' && resolution.status !== 'cancelled') {
        await recordVersionVerdict(tx, documentId, organizationId, {
          judgedHash: resolution.status === 'completed' ? moved.screenedHash : moved.dispatchedHash,
          passed: resolution.status === 'completed' && verdictPasses(moved),
        })
      }
      if (resolution.status === 'quarantined') {
        await tx
          .insert(documentQuarantineDecisions)
          .values({
            organizationId,
            documentId,
            jobId: from.jobId,
            scope: moved.scope,
            projectId: moved.projectId,
            folderId: moved.folderId,
            filename: moved.filename.slice(0, 500),
            reasons: auditedQuarantineReasons(verdict),
            reasonsOmitted: verdict?.omitted ?? 0,
            checked: verdict?.checked ?? '',
            uploadedBy: moved.createdBy,
          })
          .onConflictDoNothing({ target: [documentQuarantineDecisions.documentId, documentQuarantineDecisions.jobId] })
      }
      return true
    }),
  )
}

export async function markScreeningReleased(
  documentId: string,
  organizationId: string,
  release: { contentHash: string; releasedBy: string; releasedAt: Date },
): Promise<boolean> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      const updated = await tx
        .update(documents)
        .set({
          status: 'uploaded',
          errorMessage: null,
          quarantine: null,
          ingestFailureCategory: null,
          ingestRetryable: null,
          screeningOutcome: 'released',
          screenedHash: release.contentHash,
          screeningReleasedHash: release.contentHash,
          screeningReleasedBy: release.releasedBy,
          screeningReleasedAt: release.releasedAt,
          updatedAt: release.releasedAt,
        })
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.organizationId, organizationId),
            heldAtRest(),
            eq(documents.contentHash, release.contentHash),
          ),
        )
        .returning({ id: documents.id })
      if (updated.length === 0) return false
      await recordVersionVerdict(tx, documentId, organizationId, { judgedHash: release.contentHash, passed: true })
      return true
    }),
  )
}
