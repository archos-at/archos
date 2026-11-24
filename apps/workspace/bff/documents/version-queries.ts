import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isFolderVisibleTo } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import { memberReader } from '@/lib/documents/document-reader'
import { openRecipientsOf } from '@/lib/inbox/service'
import { resolvePeople } from '@/lib/sharing/directory'
import { getAccessibleDocument } from './access'
import type {
  DocumentVersionListResponse,
  DocumentVersionView,
  ReviewQueueQuery,
  ReviewQueueResponse,
} from './lifecycle-types'
import { reviewGroupKey } from './version-effects'
import { readerVersionViews, toDocumentVersionView } from './version-view'
import {
  findDocumentVersion,
  listDocumentVersionSummaries,
  listDocumentVersions,
  listReviewQueue,
  type DocumentVersionSummary,
} from './version-repository'

export async function listDocumentVersionViews(
  session: AuthorizedSession,
  documentId: string,
): Promise<DocumentVersionListResponse> {
  const document = await getAccessibleDocument(session, documentId, 'read')
  const rows = await listDocumentVersions(documentId, session.organizationId)
  const versions = await readerVersionViews(session, document, rows)
  const reviewerUserIds = await openReviewRound(session.organizationId, documentId, versions)
  const people = await resolvePeople(session.organizationId, [...new Set([...versionActors(versions), ...reviewerUserIds])])
  return {
    documentId,
    lifecycle: document.lifecycle,
    publishedVersionId: document.publishedVersionId,
    versions,
    reviewerUserIds,
    people: [...people.values()].map((person) => ({ userId: person.userId, name: person.name })),
  }
}

async function openReviewRound(
  organizationId: string,
  documentId: string,
  versions: readonly DocumentVersionView[],
): Promise<string[]> {
  const newest = versions.reduce<DocumentVersionView | null>(
    (best, version) => (best === null || version.versionNumber > best.versionNumber ? version : best),
    null,
  )
  if (newest?.state !== 'in_review') return []
  return openRecipientsOf(organizationId, reviewGroupKey(documentId, newest.id))
}

export async function listReviewQueueViews(
  session: AuthorizedSession,
  query: ReviewQueueQuery,
): Promise<ReviewQueueResponse> {
  if (query.projectId) await requireProjectAccess(session, query.projectId, 'project:view')
  const fetched = await listReviewQueue(session.organizationId, memberReader(session.userId), {
    role: query.role,
    userId: session.userId,
    projectId: query.projectId,
    after: query.cursor,
    limit: query.limit,
  })
  const hasMore = fetched.length > query.limit
  const rows = hasMore ? fetched.slice(0, query.limit) : fetched
  const reachable = new Map<string, Promise<boolean>>()
  const mayRead = (projectId: string) => {
    let known = reachable.get(projectId)
    if (!known) {
      known = requireProjectAccess(session, projectId, 'project:view').then(
        () => true,
        () => false,
      )
      reachable.set(projectId, known)
    }
    return known
  }
  const shown = (
    await Promise.all(
      rows.map(async (row) =>
        !row.projectId ||
        ((await mayRead(row.projectId)) && (await isFolderVisibleTo(session, row.projectId, row.folderId)))
          ? row
          : null,
      ),
    )
  ).filter((row) => row !== null)
  const people = await resolvePeople(
    session.organizationId,
    shown.flatMap((row) => (row.submittedBy ? [row.submittedBy] : [])),
  )
  return {
    versions: shown.map((row) => ({
      documentId: row.documentId,
      documentName: row.documentName,
      projectId: row.projectId,
      projectName: row.projectName,
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      submittedBy: row.submittedBy,
      submittedByName: row.submittedBy ? (people.get(row.submittedBy)?.name ?? null) : null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? (rows.at(-1)?.versionId ?? null) : null,
  }
}

function versionActors(versions: readonly DocumentVersionView[]): string[] {
  return versions.flatMap((version) =>
    [version.createdBy, version.submittedBy, version.reviewedBy, version.approvedBy, version.publishedBy].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  )
}

export async function summarizeDocumentVersions(
  organizationId: string,
  documentIds: readonly string[],
): Promise<Map<string, DocumentVersionSummary>> {
  const summaries = await listDocumentVersionSummaries(documentIds, organizationId)
  return new Map(summaries.map((summary) => [summary.documentId, summary]))
}

export async function getDocumentVersionView(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
): Promise<DocumentVersionView> {
  await getAccessibleDocument(session, documentId, 'read')
  const version = await findDocumentVersion(versionId, documentId, session.organizationId)
  if (!version) throw new NotFoundError('Version not found')
  return toDocumentVersionView(version)
}
