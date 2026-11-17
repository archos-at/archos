import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { withTenant } from '@/lib/db/tenant-context'
import { computeFolderAccess, EVERY_FOLDER, type ProjectFolderAccess } from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { collectionFileRef, purgeIngestedChunks } from '@/lib/documents/collection-file-ref'
import { IN_FLIGHT_DOCUMENT_STATUSES } from '@/lib/documents/document-status'
import { reconcileDocumentStatuses } from '@/lib/documents/reconcile-status'
import type { SettledBy } from '@/lib/analytics/ingest-events'
import { markDocumentIngestFailed } from '@/lib/documents/repository'
import { dispatchDocument } from '@/lib/documents/document-dispatch'
import { INGEST_DISPATCH_FAILED_MESSAGE } from '@/lib/documents/ingest-dispatch'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import type { JobSliceResult, PlacementReingestPayload } from '@/lib/jobs-queue/types'
import { invalidateProjectPromptViewCache } from '@/lib/project-profile/prompt-view'
import { findProjectInOrg } from '@/lib/projects/repository'
import {
  PLACEMENT_PAGE,
  awaitsPlacementReingest,
  findPlacementFolderPath,
  listPlacementRows,
  repointPlacementRow,
  tagAwaitingPlacementReingest,
  takeAwaitingPlacementReingest,
  type PlacementRow,
} from '@/lib/documents/placement-repository'

export { PLACEMENT_PAGE }

export const PURGE_TIMEOUT_MS = 15_000

export interface PlacementResult {
  moved: number
  failed: string[]
  pending: number
}

interface Misplaced {
  row: PlacementRow
  target: string
}

export const PLACEMENT_MOVES = 100

export const PLACEMENT_REINGEST_SLICE = 25

type MoveOutcome = 'handed-off' | 'repointed' | 'failed'

async function moveDocument(organizationId: string, row: PlacementRow, target: string): Promise<MoveOutcome> {
  const ref = collectionFileRef(row)
  if (ref && !(await purgeIngestedChunks(getBackendUrl(), ref, PURGE_TIMEOUT_MS, { permanent: true }))) return 'failed'
  const reingest = Boolean(ref && row.storageKey && row.authoredBy === 'user' && row.status !== 'quarantined')
  if (!(await repointPlacementRow(organizationId, row, target, { reingest }))) return 'failed'
  return reingest ? 'handed-off' : 'repointed'
}

const mustWait = (row: PlacementRow): boolean =>
  IN_FLIGHT_DOCUMENT_STATUSES.has(row.status.toLowerCase()) && !awaitsPlacementReingest(row)

async function withSettledStatuses(
  organizationId: string,
  misplaced: Misplaced[],
  settledBy: SettledBy
): Promise<Misplaced[]> {
  const inFlight = misplaced.filter(({ row }) => mustWait(row)).map(({ row }) => row)
  if (inFlight.length === 0) return misplaced
  try {
    const reconciled = await reconcileDocumentStatuses(inFlight, organizationId, settledBy)
    const statusById = new Map(reconciled.map((row) => [row.id, row.status]))
    return misplaced.map(({ row, target }) => ({ row: { ...row, status: statusById.get(row.id) ?? row.status }, target }))
  } catch (error) {
    console.warn('[placement] could not reconcile in-flight documents; they wait:', error)
    return misplaced
  }
}

interface PlacementRun {
  result: PlacementResult
  handedOff: number
  settledBy: SettledBy
}

async function placePage(organizationId: string, misplaced: Misplaced[], run: PlacementRun): Promise<void> {
  const { result } = run
  const attempted = (): number => result.moved + result.failed.length
  const settled = attempted() < PLACEMENT_MOVES ? await withSettledStatuses(organizationId, misplaced, run.settledBy) : misplaced
  for (const { row, target } of settled) {
    if (attempted() >= PLACEMENT_MOVES || mustWait(row)) {
      result.pending += 1
      continue
    }
    const outcome = await moveDocument(organizationId, row, target)
    if (outcome === 'failed') {
      result.failed.push(row.id)
      continue
    }
    result.moved += 1
    if (outcome === 'handed-off') run.handedOff += 1
  }
}

async function queuePlacementReingest(organizationId: string, projectId: string): Promise<void> {
  try {
    await withTenant({ organizationId }, async () => {
      const kind = 'placement_reingest'
      const open = await findOpenJobId({ kind, organizationId, matching: { projectId }, notStarted: true })
      const payload: PlacementReingestPayload = { projectId }
      const jobId = open ?? (await enqueueJob({ kind, organizationId, payload })).jobId
      await tagAwaitingPlacementReingest(organizationId, projectId, jobId)
    })
  } catch (error) {
    console.warn(`[placement] could not queue the re-read of project ${projectId}; the stranded-row sweep will:`, error)
  }
}

async function reingestPlacedRow(
  organizationId: string,
  projectId: string,
  placement: ProjectFolderAccess,
  row: PlacementRow
): Promise<void> {
  const target = placement.collectionFor(row.folderId)
  if (target !== row.collectionName && !(await repointPlacementRow(organizationId, row, target, { reingest: false }))) {
    await markDocumentIngestFailed(row.id, organizationId, INGEST_DISPATCH_FAILED_MESSAGE)
    return
  }
  if (!row.storageKey) return
  try {
    await dispatchDocument({
      organizationId,
      projectId,
      documentId: row.id,
      filename: row.filename,
      storageKey: row.storageKey,
      storageBucket: row.storageBucket,
      collectionName: target,
      folderPath: await findPlacementFolderPath(organizationId, projectId, row.folderId),
      priority: 'bulk',
    })
  } catch (error) {
    console.warn(`[placement] re-ingest of ${row.id} into ${target} failed:`, error)
  }
}

export async function runPlacementReingestSlice(
  organizationId: string,
  payload: PlacementReingestPayload
): Promise<JobSliceResult<PlacementReingestPayload>> {
  const project = await findProjectInOrg(payload.projectId, organizationId)
  if (!project) return { done: true, payload }
  const { placement } = await projectPlacement(organizationId, payload.projectId, project.collectionName)
  const rows = await takeAwaitingPlacementReingest(organizationId, payload.projectId, PLACEMENT_REINGEST_SLICE)
  for (const row of rows) await reingestPlacedRow(organizationId, payload.projectId, placement, row)
  return { done: rows.length < PLACEMENT_REINGEST_SLICE, payload }
}

async function projectPlacement(organizationId: string, projectId: string, projectCollection: string) {
  const tree = await listProjectFolderTree(organizationId, projectId)
  return { tree, placement: computeFolderAccess(tree, EVERY_FOLDER, projectCollection) }
}

export async function placeProjectDocuments(organizationId: string, projectId: string): Promise<PlacementResult> {
  await invalidateProjectPromptViewCache(projectId, organizationId)
  try {
    return await retryProjectPlacement(organizationId, projectId, 'read')
  } finally {
    await invalidateProjectPromptViewCache(projectId, organizationId)
  }
}

export async function retryProjectPlacement(
  organizationId: string,
  projectId: string,
  settledBy: SettledBy
): Promise<PlacementResult> {
  const run: PlacementRun = { result: { moved: 0, failed: [], pending: 0 }, handedOff: 0, settledBy }
  const project = await findProjectInOrg(projectId, organizationId)
  if (!project) return run.result
  const { tree, placement } = await projectPlacement(organizationId, projectId, project.collectionName)
  const restrictedSubtree = tree
    .filter((folder) => placement.collectionFor(folder.id) !== project.collectionName)
    .map((folder) => folder.id)
  const deleted = new Set(tree.filter((folder) => folder.deleted).map((folder) => folder.id))
  let afterId: string | null = null
  for (;;) {
    const page = await listPlacementRows(organizationId, projectId, project.collectionName, restrictedSubtree, afterId)
    const misplaced = page
      .filter((row) => row.folderId === null || !deleted.has(row.folderId))
      .map((row) => ({ row, target: placement.collectionFor(row.folderId) }))
      .filter(({ row, target }) => target !== row.collectionName)
    await placePage(organizationId, misplaced, run)
    if (page.length < PLACEMENT_PAGE) break
    afterId = page[page.length - 1].id
  }
  if (run.handedOff > 0) await queuePlacementReingest(organizationId, projectId)
  return run.result
}
