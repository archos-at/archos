import 'server-only'
import type { FolderItem } from '@/features/documents/components/project-file-workspace'
import type { DocumentWireRow } from '@/features/documents/lib/file-item'
import type { ProjectFolderRow } from '@/lib/projects/folder-service'
import type { ListedDocument } from './shelf-listing'
import { summarizeDocumentVersions } from './lifecycle'
import { entryIdsForDocuments } from '@/lib/base-knowledge/store/repository'
import { mailThreadsOfDocuments, type DocumentMailThread } from '@/lib/mail-thread/document-threads'
import type { DocumentVersionState } from './lifecycle-types'

export function toDocumentWireRow(
  row: ListedDocument,
  summary?: { versionCount: number; state: DocumentVersionState },
): DocumentWireRow & {
  collectionName: string
  updatedAt: string
} {
  return {
    versionState: summary?.state ?? null,
    versionCount: summary?.versionCount ?? null,
    lifecycle: row.lifecycle,
    id: row.id,
    filename: row.filename,
    displayName: row.displayName,
    fileSize: row.fileSize,
    contentType: row.contentType,
    status: row.status,
    authoredBy: row.authoredBy,
    collectionName: row.collectionName,
    folderId: row.folderId,
    originPath: row.originPath,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    errorMessage: row.errorMessage,
    quarantine: row.quarantine ?? null,
    summary: row.summary ?? null,
    pageCount: row.pageCount ?? null,
    chunkCount: row.chunkCount ?? null,
    contentTypes: row.contentTypes ?? null,
    tags: row.tags ?? null,
    topics: row.topics ?? null,
    capture: row.capture ?? null,
    revisionFacts: row.revisionFacts ?? null,
    dossier: row.dossier ?? null,
    docReferences: row.docReferences ?? null,
    coverage: row.coverage ?? null,
    revision: row.revision ?? null,
    queueAhead: row.queueAhead ?? null,
    retryable: row.retryable ?? true,
    assignees: row.assignees,
    sourceDeletedAt: row.sourceDeletedAt ?? null,
    marks: row.marks ?? null,
  }
}

export async function toDocumentWireRows(
  organizationId: string,
  rows: ListedDocument[],
  { officeShelf = false }: { officeShelf?: boolean } = {},
): Promise<Array<ReturnType<typeof toDocumentWireRow> & { baseKnowledgeEntryId: string | null; mailThread: DocumentMailThread | null }>> {
  const ids = rows.map((row) => row.id)
  const shelfIds = officeShelf ? ids : []
  const [versions, entries, threads] = await Promise.all([
    summarizeDocumentVersions(organizationId, ids),
    entryIdsForDocuments(organizationId, shelfIds),
    officeShelf ? new Map() : mailThreadsOfDocuments(organizationId, ids),
  ])
  return rows.map((row) => ({
    ...toDocumentWireRow(row, versions.get(row.id)),
    baseKnowledgeEntryId: entries.get(row.id) ?? null,
    mailThread: threads.get(row.id) ?? null,
  }))
}

export function toFolderWireRow(row: ProjectFolderRow): FolderItem {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    path: row.path,
    ownAccess: row.ownAccess,
    access: row.access,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
