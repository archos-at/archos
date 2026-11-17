import type { AuthorizedSession } from '@/lib/auth/types'
import { isCollaborationEnabled } from '@/lib/authz/feature-flags'
import { listAssignmentsWithoutAccessCheck, type AssignedPerson } from '@/lib/assignments/service'
import { tallyLiveMarks } from '@/lib/annotations/repository'
import type { MarkTally } from '@/lib/annotations/types'
import { encodeDocumentLevelCursor } from './list-cursor'
import { reconcileDocumentStatuses, type DocumentMetadata } from './reconcile-status'
import type { RevisionLinks } from './revision-links'
import { loadRevisionLinks } from './revision-links-loader'
import type { DocumentLevelPage, DocumentListRow } from './repository'
import { keepReadable, type ListingReader, type ShelfReader } from './document-reader'
import { canRetryRow } from './retry-policy'
import { quarantineVerdictOf, type QuarantineVerdict } from '@/lib/upload-screening/quarantine'

export type ListedDocument = Omit<
  DocumentListRow,
  | 'projectId'
  | 'scope'
  | 'metadata'
  | 'createdBy'
  | 'screeningOutcome'
  | 'screenedHash'
  | 'ingestFailureCategory'
  | 'ingestRetryable'
  | 'ingestReaderVersion'
  | 'quarantine'
> &
  DocumentMetadata & {
    assignees: AssignedPerson[]
    retryable?: boolean
    revision?: RevisionLinks | null
    sourceDeletedAt?: string | null
    marks?: MarkTally | null
    quarantine: QuarantineVerdict | null
  }

function sourceDeletedAtOf(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const mark = (metadata as { sourceDeleted?: { at?: unknown } }).sourceDeleted
  const at = mark && typeof mark === 'object' ? mark.at : undefined
  return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : null
}

export async function toListedDocuments(
  session: AuthorizedSession,
  rows: DocumentListRow[],
  reader: ListingReader,
): Promise<ListedDocument[]> {
  const reconciled = keepReadable(await reconcileDocumentStatuses(rows, session.organizationId, 'read'), reader)

  const [revision, marks] = await Promise.all([
    loadRevisionLinks(session, reconciled, reader),
    tallyLiveMarks(
      session.organizationId,
      reconciled.map((row) => row.id),
      reader,
      session.userId,
    ),
  ])
  const listed = reconciled.map(
    ({
      metadata,
      createdBy: _createdBy,
      projectId: _projectId,
      scope: _scope,
      screeningOutcome: _screening,
      screenedHash: _screened,
      ingestFailureCategory,
      ingestRetryable,
      ingestReaderVersion,
      quarantine,
      ...row
    }) => ({
      ...row,
      quarantine: quarantineVerdictOf({ quarantine, errorMessage: row.errorMessage }),
      retryable: canRetryRow({
        status: row.status,
        contentHash: row.contentHash,
        metadata,
        ingestFailureCategory,
        ingestRetryable,
        ingestReaderVersion,
      }),
      sourceDeletedAt: sourceDeletedAtOf(metadata),
      revision: revision.get(row.id) ?? null,
      marks: marks.get(row.id) ?? null,
    })
  )

  if (!isCollaborationEnabled(session) || listed.length === 0) {
    return listed.map((row) => ({ ...row, assignees: [] }))
  }

  const grouped = await listAssignmentsWithoutAccessCheck(
    session,
    'document',
    listed.map((row) => row.id),
  )
  return listed.map((row) => ({ ...row, assignees: grouped[row.id] ?? [] }))
}

export async function toListedLevelPage(
  session: AuthorizedSession,
  page: DocumentLevelPage,
  reader: ShelfReader,
): Promise<{ documents: ListedDocument[]; nextCursor: string | null }> {
  return {
    documents: await toListedDocuments(session, page.rows, reader),
    nextCursor: page.nextCursor ? encodeDocumentLevelCursor(page.nextCursor) : null,
  }
}
