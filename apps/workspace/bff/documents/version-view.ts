import 'server-only'
/**
 * One version as the wire carries it, and the version list as one reader
 * receives it: whether they may have each Fassung's bytes (ADR-0086) and which
 * mail brought it (D36). `./lifecycle.ts` serves both.
 */

import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { documentMailOrigins, mailOriginsByVersion } from '@/lib/mail-thread/mail-origins'
import type { DocumentVersionView } from './lifecycle-types'
import { versionBytesReadableBy } from './version-content'

/** One version as the wire carries it. Dates as ISO strings, no storage keys. */
export function toDocumentVersionView(version: DocumentVersion): DocumentVersionView {
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    state: version.state,
    contentType: version.contentType,
    fileSize: version.fileSize,
    contentHash: version.contentHash,
    submittedBy: version.submittedBy,
    submittedAt: version.submittedAt?.toISOString() ?? null,
    reviewedBy: version.reviewedBy,
    reviewedAt: version.reviewedAt?.toISOString() ?? null,
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt?.toISOString() ?? null,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    reviewComment: version.reviewComment,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  }
}

/**
 * Every version of `document` as `session` receives it in the version list:
 * `bytesReadable` says whether `…/versions/{id}/file` and `/content` will hand
 * this reader the bytes, so the timeline offers Öffnen only where they will;
 * `mailOrigins` which mail brought the Fassung, through the threads this reader
 * may read, and only on a Fassung a mail brought.
 */
export async function readerVersionViews(
  session: AuthorizedSession,
  document: Document,
  rows: readonly DocumentVersion[],
): Promise<DocumentVersionView[]> {
  const readable = await versionBytesReadableBy(session, document, rows)
  const origins = mailOriginsByVersion(await documentMailOrigins(session, document))
  return rows.map((version) => {
    const mailOrigins = origins.get(version.id)
    return { ...toDocumentVersionView(version), bytesReadable: readable(version), ...(mailOrigins ? { mailOrigins } : {}) }
  })
}
