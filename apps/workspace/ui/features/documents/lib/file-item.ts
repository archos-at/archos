import { documentStatusFacts } from '@/lib/documents/document-status'
import { sameValue } from '@/lib/utils/same-value'
import type { FileAssignee, FileItem } from '../components/project-file-workspace'

export type DocumentWireRow = Omit<FileItem, OptionalWireField> &
  Partial<Pick<FileItem, OptionalWireField>>

type OptionalWireField =
  | 'authoredBy'
  | 'displayName'
  | 'folderId'
  | 'errorMessage'
  | 'quarantine'
  | 'summary'
  | 'pageCount'
  | 'chunkCount'
  | 'contentTypes'
  | 'tags'
  | 'topics'
  | 'capture'
  | 'revisionFacts'
  | 'dossier'
  | 'docReferences'
  | 'coverage'
  | 'queueAhead'
  | 'originPath'
  | 'contentHash'
  | 'assignees'
  | 'versionState'
  | 'versionCount'
  | 'lifecycle'
  | 'sourceDeletedAt'
  | 'marks'
  | 'baseKnowledgeEntryId'
  | 'mailThread'

export function toFileItem(row: DocumentWireRow): FileItem {
  return {
    id: row.id,
    filename: row.filename,
    displayName: row.displayName ?? null,
    fileSize: row.fileSize,
    contentType: row.contentType,
    status: row.status,
    folderId: row.folderId ?? null,
    originPath: row.originPath ?? null,
    contentHash: row.contentHash ?? null,
    createdAt: row.createdAt,
    errorMessage: row.errorMessage ?? null,
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
    assignees: row.assignees ?? EMPTY_ASSIGNEES,
    authoredBy: row.authoredBy ?? 'user',
    versionState: row.versionState ?? null,
    versionCount: row.versionCount ?? null,
    lifecycle: row.lifecycle ?? 'active',
    sourceDeletedAt: row.sourceDeletedAt ?? null,
    marks: row.marks ?? null,
    baseKnowledgeEntryId: row.baseKnowledgeEntryId ?? null,
    mailThread: row.mailThread ?? null,
    retryable: row.retryable ?? true,
  }
}

const EMPTY_ASSIGNEES: readonly FileAssignee[] = Object.freeze([])

const TRAILING_METADATA: ReadonlySet<keyof FileItem> = new Set<keyof FileItem>([
  'summary',
  'pageCount',
  'chunkCount',
  'contentTypes',
  'tags',
  'topics',
  'capture',
  'revisionFacts',
  'dossier',
  'docReferences',
  'coverage',
])

const REGRESSION_FIELDS: ReadonlySet<keyof FileItem> = new Set<keyof FileItem>(['status', 'errorMessage', 'quarantine'])

function isStaleRegression(
  current: FileItem,
  fresh: Partial<FileItem>,
  fields: readonly (keyof FileItem)[]
): boolean {
  if (!fields.includes('status') || !('status' in fresh)) return false
  if (documentStatusFacts(current.status)?.phase !== 'terminal') return false
  if (documentStatusFacts(fresh.status)?.phase !== 'in-flight') return false
  const grew =
    fresh.versionCount != null && (current.versionCount == null || fresh.versionCount > current.versionCount)
  return !grew
}

export function refreshedFileFields(
  current: FileItem,
  fresh: Partial<FileItem>,
  fields: readonly (keyof FileItem)[] = Object.keys(fresh) as (keyof FileItem)[]
): Partial<FileItem> | null {
  const patch: Record<string, unknown> = {}
  let changed = false
  const heldBack = isStaleRegression(current, fresh, fields)
  for (const field of fields) {
    if (!(field in fresh)) continue
    if (heldBack && REGRESSION_FIELDS.has(field)) continue
    const next = fresh[field]
    if (next == null && TRAILING_METADATA.has(field) && current[field] != null) continue
    if (sameValue(current[field], next)) continue
    patch[field] = next
    changed = true
  }
  return changed ? (patch as Partial<FileItem>) : null
}
