import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { documentMailOrigins, mailOriginsByVersion } from '@/lib/mail-thread/mail-origins'
import type { DocumentVersionView } from './lifecycle-types'
import { versionBytesReadableBy } from './version-content'

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
    changeNote: version.changeNote ?? null,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  }
}

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
