import 'server-only'
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  atLeast,
  clearanceOf,
  computeFolderAccess,
  folderTree,
  isUnderOwnList,
  loadCustomFolderTree,
  unreadableFolderIds,
  type FolderTree,
  type ProjectFolderAccess,
} from '@/lib/authz/folder-access'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { Document } from '@/lib/db/schema/documents'
import {
  DEFAULT_UPLOAD_BATCH_EFFECTS,
  type UploadBatch,
  type UploadBatchEffects,
  type UploadBatchExclusion,
  type UploadBatchScope,
} from '@/lib/db/schema/upload-batches'
import { surfaceStateOf, type SurfaceState } from '@/lib/documents/surface-state'
import { reconcileDocumentStatuses, type DocumentMetadata } from '@/lib/documents/reconcile-status'
import { encodeDocumentListCursor, type DocumentListCursor } from '@/lib/documents/list-cursor'
import { findFolderPathsInProject } from '@/lib/documents/repository'
import { memberReader } from '@/lib/documents/document-reader'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { findProjectInOrg } from '@/lib/projects/repository'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { quarantineVerdictOf, type QuarantineVerdict } from '@/lib/upload-screening/quarantine'
import {
  addUploadBatchExclusions,
  countBatchDocumentsByStatus,
  findUploadBatch,
  insertUploadBatch,
  listBatchDocuments,
  listProjectUploadBatchPage,
  sealUploadBatch,
} from './repository'

export { UPLOAD_BATCH_SCOPES } from '@/lib/db/schema/upload-batches'

import { UPLOAD_BATCH_MAX_FILES } from './batch-wire'

export { UPLOAD_BATCH_MAX_FILES }

export interface OpenUploadBatchInput {
  id: string
  scope: UploadBatchScope
  projectId: string | null
  conversationId: string | null
  expectedCount: number
  excluded: UploadBatchExclusion[]
  effects?: Partial<UploadBatchEffects>
}

export async function openUploadBatch(session: AuthorizedSession, input: OpenUploadBatchInput): Promise<void> {
  if (input.scope === 'project') {
    if (!input.projectId) throw new BadRequestError('A project upload names its project')
    await requireProjectAccess(session, input.projectId, ['project:documents:write', 'project:edit'])
  } else if (input.scope === 'office_shelf' && !canManageOfficeShelf(session)) {
    throw new NotFoundError('Upload not found')
  }
  await insertUploadBatch({
    id: input.id,
    organizationId: session.organizationId,
    createdBy: session.userId,
    scope: input.scope,
    projectId: input.scope === 'project' ? input.projectId : null,
    conversationId: input.scope === 'session' ? input.conversationId : null,
    expectedCount: input.expectedCount,
    excluded: input.excluded,
    ...DEFAULT_UPLOAD_BATCH_EFFECTS,
    ...input.effects,
  })
}

export async function findOwnUploadBatch(session: AuthorizedSession, batchId: string): Promise<UploadBatch | null> {
  const batch = await findUploadBatch(session.organizationId, batchId)
  return batch && batch.createdBy === session.userId ? batch : null
}

export async function acceptedUploadBatchId(
  session: AuthorizedSession,
  rawId: unknown,
  shelf: { scope: UploadBatchScope; projectId: string | null }
): Promise<string | null> {
  if (typeof rawId !== 'string' || !UUID_PATTERN.test(rawId)) return null
  const batch = await findOwnUploadBatch(session, rawId).catch(() => null)
  if (!batch || batch.sealedAt || batch.scope !== shelf.scope) return null
  if (shelf.scope === 'project' && batch.projectId !== shelf.projectId) return null
  return batch.id
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readUploadBatchId(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null
}

export async function sealOwnUploadBatch(
  session: AuthorizedSession,
  batchId: string,
  counts: { unchanged: number; failed: number; excluded?: UploadBatchExclusion[] }
): Promise<void> {
  const batch = await findOwnUploadBatch(session, batchId)
  if (!batch) throw new NotFoundError('Upload not found')
  if (batch.sealedAt) return
  const sealed = await sealUploadBatch(session.organizationId, batchId, session.userId, counts, new Date())
  if (!sealed) throw new ConflictError('The upload changed while it was being sealed')
  await import('@/lib/filing/trigger')
    .then(({ queueFilingReview }) => queueFilingReview(session.organizationId, batch, 'name'))
    .catch((error: unknown) => console.warn(`[filing] the name review of batch ${batch.id} was not queued; the upload is unaffected:`, error))
  const { settleUploadBatches } = await import('./settle')
  await settleUploadBatches(session.organizationId, [batchId])
}

export async function recordJobUploadExclusions(
  organizationId: string,
  batchId: string,
  createdBy: string,
  excluded: readonly UploadBatchExclusion[]
): Promise<void> {
  try {
    await addUploadBatchExclusions(organizationId, batchId, createdBy, excluded)
  } catch (error) {
    console.warn(`[upload-batches] could not record exclusions on batch ${batchId}; the import still lists them:`, error)
  }
}

export type JobUploadBatchState =
  | { status: 'missing' | 'foreign' | 'sealed' }
  | { status: 'open'; documents: number }

export async function findJobUploadBatch(
  organizationId: string,
  batchId: string,
  createdBy: string
): Promise<JobUploadBatchState> {
  const batch = await findUploadBatch(organizationId, batchId)
  if (!batch) return { status: 'missing' }
  if (batch.createdBy !== createdBy) return { status: 'foreign' }
  if (batch.sealedAt) return { status: 'sealed' }
  return { status: 'open', documents: await countUploadBatchDocuments(organizationId, batchId, createdBy) }
}

async function countUploadBatchDocuments(organizationId: string, batchId: string, createdBy: string): Promise<number> {
  const counts = await countBatchDocumentsByStatus(organizationId, [batchId], { reader: memberReader(createdBy) })
  return counts.reduce((sum, row) => sum + row.count, 0)
}

export async function sealJobUploadBatch(organizationId: string, batchId: string, createdBy: string): Promise<void> {
  const state = await findJobUploadBatch(organizationId, batchId, createdBy)
  if (state.status !== 'open') return
  const expected = Math.min(state.documents, UPLOAD_BATCH_MAX_FILES)
  await sealUploadBatch(organizationId, batchId, createdBy, { unchanged: 0, failed: 0, expected }, new Date())
  const { settleUploadBatches } = await import('./settle')
  await settleUploadBatches(organizationId, [batchId])
}

export interface UploadSummaryDocument {
  id: string
  filename: string
  displayName: string | null
  folderPath: string | null
  status: string
  outcome: 'ready' | 'reading' | 'quarantined' | 'failed' | 'stored'
  screening: Document['screeningOutcome']
  quarantine: QuarantineVerdict | null
  errorMessage: string | null
  summary: string | null
  tags: string[]
  pageCount: number | null
  replaced: boolean
  restricted: boolean
}

export interface UploadSummary {
  id: string
  scope: UploadBatchScope
  projectId: string | null
  conversationId: string | null
  createdAt: string
  sealedAt: string | null
  completedAt: string | null
  expectedCount: number
  unchangedCount: number
  failedCount: number
  excluded: UploadBatchExclusion[]
  documents: UploadSummaryDocument[]
}

const OUTCOME_BY_STATE: Record<SurfaceState, UploadSummaryDocument['outcome']> = {
  citable: 'ready',
  uploading: 'reading',
  reading: 'reading',
  held: 'quarantined',
  unreadable: 'failed',
  stored: 'stored',
  cancelled: 'stored',
  unknown: 'reading',
}

function outcomeOf(status: string): UploadSummaryDocument['outcome'] {
  return OUTCOME_BY_STATE[surfaceStateOf(status)]
}

type EnrichedDocument = Document & DocumentMetadata

function toSummaryDocument(
  row: EnrichedDocument,
  folderPaths: Map<string, string>,
  facts: { replaced: boolean; restricted: boolean }
): UploadSummaryDocument {
  return {
    id: row.id,
    filename: row.filename,
    displayName: row.displayName ?? null,
    folderPath: row.folderId ? (folderPaths.get(row.folderId) ?? null) : null,
    status: row.status,
    outcome: outcomeOf(row.status),
    screening: row.screeningOutcome,
    quarantine: quarantineVerdictOf(row),
    errorMessage: row.status === 'quarantined' ? null : row.errorMessage,
    summary: row.summary ?? null,
    tags: row.tags ?? [],
    pageCount: row.pageCount ?? null,
    ...facts,
  }
}

type BatchCounts = Pick<UploadBatch, 'expectedCount' | 'unchangedCount' | 'failedCount' | 'excluded'>

function batchCounts(batch: UploadBatch, placed: number | null): BatchCounts {
  if (placed === null) {
    const { expectedCount, unchangedCount, failedCount, excluded } = batch
    return { expectedCount, unchangedCount, failedCount, excluded }
  }
  return { expectedCount: placed, unchangedCount: 0, failedCount: 0, excluded: [] }
}

async function readerFolders(
  session: AuthorizedSession,
  projectId: string
): Promise<{ tree: FolderTree; access: ProjectFolderAccess } | null> {
  const folders = await loadCustomFolderTree(session.organizationId, projectId)
  if (!folders) return null
  return { tree: folderTree(folders), access: computeFolderAccess(folders, await clearanceOf(session, projectId), '') }
}

interface ReaderView {
  rows: Document[]
  withheld: boolean
  isRestricted: (folderId: string | null) => boolean
}

const UNRESTRICTED = (): boolean => false

async function readerView(session: AuthorizedSession, batch: UploadBatch, rows: Document[]): Promise<ReaderView> {
  const open = { rows, withheld: false, isRestricted: UNRESTRICTED }
  if (batch.scope !== 'project' || !batch.projectId) return open
  const project = await findProjectInOrg(batch.projectId, session.organizationId)
  if (!project) return { rows: [], withheld: false, isRestricted: UNRESTRICTED }
  const folders = await readerFolders(session, batch.projectId)
  if (!folders) return open
  const { tree, access } = folders
  return {
    rows: rows.filter((row) => access.isVisible(row.folderId)),
    withheld: rows.some((row) => row.folderId !== null && !atLeast(access.levelOf(row.folderId), 'read')),
    isRestricted: (folderId) => isUnderOwnList(tree, folderId),
  }
}

export async function getUploadSummary(session: AuthorizedSession, batchId: string): Promise<UploadSummary> {
  const batch = await findOwnUploadBatch(session, batchId)
  if (!batch) throw new NotFoundError('Upload not found')
  const rows = await listBatchDocuments(session.organizationId, batchId, memberReader(session.userId))
  const view = await readerView(session, batch, rows)
  const enriched = await reconcileDocumentStatuses(view.rows, session.organizationId, 'read')
  const folderIds = [...new Set(enriched.map((row) => row.folderId).filter((id): id is string => !!id))]
  const folderPaths =
    batch.projectId && folderIds.length > 0
      ? await findFolderPathsInProject(folderIds, batch.projectId, session.organizationId)
      : new Map<string, string>()
  const fresh = await findOwnUploadBatch(session, batchId)
  const openedAt = new Date(batch.createdAt).getTime()
  return {
    id: batch.id,
    scope: batch.scope,
    projectId: batch.projectId,
    conversationId: batch.conversationId,
    createdAt: new Date(batch.createdAt).toISOString(),
    sealedAt: batch.sealedAt ? new Date(batch.sealedAt).toISOString() : null,
    completedAt: fresh?.completedAt ? new Date(fresh.completedAt).toISOString() : null,
    ...batchCounts(batch, view.withheld ? enriched.length : null),
    documents: enriched.map((row) =>
      toSummaryDocument(row, folderPaths, {
        replaced: new Date(row.createdAt).getTime() < openedAt,
        restricted: view.isRestricted(row.folderId ?? null),
      })
    ),
  }
}

export interface UploadHistoryEntry {
  id: string
  createdBy: string
  createdByName: string | null
  createdAt: string
  completedAt: string | null
  expectedCount: number
  unchangedCount: number
  failedCount: number
  excludedCount: number
  counts: Record<UploadSummaryDocument['outcome'], number>
}

function foldersClosedToReader(tree: FolderTree, access: ProjectFolderAccess): string[] {
  return unreadableFolderIds(access).filter((folderId) => !tree.get(folderId)?.purgedAt)
}

export interface UploadHistoryPage {
  uploads: UploadHistoryEntry[]
  nextCursor: string | null
}

export async function listProjectUploadHistory(
  session: AuthorizedSession,
  projectId: string,
  { cursor }: { cursor?: DocumentListCursor } = {}
): Promise<UploadHistoryPage> {
  await requireProjectAccess(session, projectId, 'project:view')
  const [{ batches, nextCursor }, folders] = await Promise.all([
    listProjectUploadBatchPage(session.organizationId, projectId, { cursor }),
    readerFolders(session, projectId),
  ])
  const hiddenFolderIds = folders ? [...folders.access.hiddenFolderIds] : []
  const reader = await shelfReaderFor(session, { scope: 'project', projectId })
  const filesHiddenFromReader = folders !== null && foldersClosedToReader(folders.tree, folders.access).length > 0
  const [counts, directory] = await Promise.all([
    countBatchDocumentsByStatus(
      session.organizationId,
      batches.map((batch) => batch.id),
      { hiddenFolderIds, reader }
    ),
    loadOrganizationDirectory(session.organizationId),
  ])
  const uploads = batches.flatMap((batch): UploadHistoryEntry[] => {
    const tally: UploadHistoryEntry['counts'] = { ready: 0, reading: 0, quarantined: 0, failed: 0, stored: 0 }
    for (const row of counts) {
      if (row.batchId === batch.id) tally[outcomeOf(row.status)] += row.count
    }
    const placed = Object.values(tally).reduce((sum, count) => sum + count, 0)
    if (filesHiddenFromReader && placed === 0) return []
    const own = batchCounts(batch, filesHiddenFromReader ? placed : null)
    return [
      {
        id: batch.id,
        createdBy: batch.createdBy,
        createdByName: directory.get(batch.createdBy)?.name ?? null,
        createdAt: new Date(batch.createdAt).toISOString(),
        completedAt: batch.completedAt ? new Date(batch.completedAt).toISOString() : null,
        expectedCount: own.expectedCount,
        unchangedCount: own.unchangedCount,
        failedCount: own.failedCount,
        excludedCount: own.excluded.reduce((sum, entry) => sum + entry.count, 0),
        counts: tally,
      },
    ]
  })
  return { uploads, nextCursor: nextCursor ? encodeDocumentListCursor(nextCursor) : null }
}
