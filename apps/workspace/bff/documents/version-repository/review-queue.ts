import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { inboxItems } from '@/lib/db/schema/inbox'
import { projects } from '@/lib/db/schema/projects'
import { documentVisibleTo, type ShelfReader } from '../visibility'

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
