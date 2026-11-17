import 'server-only'
import { randomUUID } from 'node:crypto'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { RootSortRun } from '@/lib/db/schema/root-sort-runs'
import { isUniqueViolation } from '@/lib/db/errors'
import { memberReader } from '@/lib/documents/document-reader'
import { moveDocumentsToFolders } from '@/lib/documents/move-to-folder'
import { OFFICE_SHELF, projectShelf, type DocumentShelf } from '@/lib/documents/shelf'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY, requesterOf, type JobSliceResult, type RootSortPayload } from '@/lib/jobs-queue/types'
import { ensureOfficeShelfFolderPaths } from '@/lib/office-shelf/folder-service'
import { folderPathKey } from '@/lib/projects/folders'
import { ensureProjectFolderPaths } from '@/lib/projects/folder-service'
import { findRootDocuments, findShelfFolderPaths } from './repository'
import { announceRootSortRun, settleRootSortNotices } from './root-sort-announce'
import { planRootChunk, proposeRootFolders, requireSortable, scanRoot, sortContextFor } from './root-sort'
import {
  cancelReadyRootSortRuns,
  failStalledRootSortRuns,
  findLatestRootSortRun,
  findRootSortRun,
  insertRootSortRun,
  isRootSortJobWaiting,
  recordRootSortProgress,
  updateRootSortRun,
  type RootSortRunPatch,
} from './root-sort-run-repository'
import {
  CHUNKS_PER_SLICE,
  MAX_MOVES_PER_SLICE,
  MAX_NEW_FOLDER_DOCUMENTS,
  ROOT_SORT_CHUNK,
  ROOT_SORT_LIFECYCLE,
  ROOT_SORT_WORKING_STATUSES,
  type KeptMove,
  type RootSortRunStatus,
  type RootSortRunView,
} from './root-sort-types'

const ONE_IN_WORK_INDEX = 'root_sort_runs_one_in_work_per_shelf'

export const MOVE_SLICE_BUDGET_MS = 180_000

const MOVES_IN_FLIGHT = 4

const PROGRESS_WRITE_MS = 1_000

const RECENT_PLACEMENTS = 4

async function settleStalledRuns(organizationId: string, shelf: DocumentShelf): Promise<void> {
  const ended = await failStalledRootSortRuns(organizationId, shelf)
  for (const run of ended) await announceRootSortRun(run)
}

export function shelfOfRun(run: Pick<RootSortRun, 'scope' | 'projectId'>): DocumentShelf {
  return run.scope === 'project' && run.projectId ? projectShelf(run.projectId) : OFFICE_SHELF
}

export async function describeRootSort(session: AuthorizedSession, shelf: DocumentShelf) {
  const scan = await scanRoot(session, shelf)
  await settleStalledRuns(session.organizationId, shelf)
  const latest = await findLatestRootSortRun(session.organizationId, shelf, session.userId)
  return {
    files: scan.documents.length,
    folders: scan.folders.length,
    unreadable: scan.unreadable,
    truncated: scan.truncated,
    run: latest ? await viewOf(session, latest) : null,
  }
}


export async function startRootSort(session: AuthorizedSession, shelf: DocumentShelf): Promise<RootSortRunView> {
  const scan = await scanRoot(session, shelf)
  if (scan.folders.length === 0) throw new BadRequestError('The shelf has no folder to sort into.')
  if (scan.documents.length === 0) throw new BadRequestError('The root holds no file to sort.')
  await settleStalledRuns(session.organizationId, shelf)
  const replaced = await cancelReadyRootSortRuns(session.organizationId, shelf, session.userId)
  await Promise.all(replaced.map((ready) => settleRootSortNotices(ready)))
  let run: RootSortRun
  try {
    run = await insertRootSortRun({
      organizationId: session.organizationId,
      scope: shelf.kind,
      projectId: shelf.kind === 'project' ? shelf.projectId : null,
      requestedBy: session.userId,
      status: 'judging',
      documentIds: scan.documents.map((document) => document.id),
      unreadable: scan.unreadable,
      truncated: scan.truncated,
    })
  } catch (error) {
    if (isUniqueViolation(error, ONE_IN_WORK_INDEX)) throw new ConflictError('A sort of this shelf is already running.')
    throw error
  }
  const queued = await enqueueOrRevert(session, run, ['judging'], {
    status: 'failed',
    error: 'not_queued',
    finishedAt: new Date(),
  })
  return viewOf(session, queued)
}

async function enqueueOrRevert(
  session: AuthorizedSession,
  run: RootSortRun,
  from: readonly RootSortRunStatus[],
  revert: RootSortRunPatch
): Promise<RootSortRun> {
  const jobId = randomUUID()
  const named = (await updateRootSortRun(session.organizationId, run.id, from, { jobId })) ?? run
  const payload: RootSortPayload = { runId: run.id, requester: requesterOf(session) }
  try {
    await enqueueJob({
      kind: 'root_sort',
      organizationId: session.organizationId,
      payload,
      priority: BFF_JOB_PRIORITY.interactive,
      jobId,
    })
  } catch (error) {
    await updateRootSortRun(session.organizationId, run.id, from, { ...revert, jobId: null })
    throw error
  }
  return named
}

async function ownRun(session: AuthorizedSession, runId: string): Promise<RootSortRun> {
  const found = await findRootSortRun(session.organizationId, runId)
  if (!found || found.requestedBy !== session.userId) throw new NotFoundError('Run not found.')
  await requireSortable(session, shelfOfRun(found))
  await settleStalledRuns(session.organizationId, shelfOfRun(found))
  return (await findRootSortRun(session.organizationId, runId)) ?? found
}

export async function getRootSortRun(session: AuthorizedSession, runId: string): Promise<RootSortRunView> {
  return viewOf(session, await ownRun(session, runId))
}

async function transition(
  session: AuthorizedSession,
  run: RootSortRun,
  from: readonly RootSortRunStatus[],
  patch: RootSortRunPatch
): Promise<RootSortRun> {
  const updated = await updateRootSortRun(session.organizationId, run.id, from, patch)
  if (!updated) throw new ConflictError(`The run is ${run.status}; it cannot do that now.`)
  await settleRootSortNotices(updated)
  return updated
}

export function keptMovesOf(
  run: Pick<RootSortRun, 'documentIds' | 'placements' | 'newFolders'>,
  keep: readonly KeptMove[],
  openFolderIds: ReadonlySet<string>
): KeptMove[] {
  const known = new Set(run.documentIds)
  const proposed = new Set(
    [
      ...run.newFolders.map((folder) => folder.path),
      ...run.placements.flatMap((placement) => (placement.newFolderPath ? [placement.newFolderPath] : [])),
    ].map(folderPathKey)
  )
  const seen = new Set<string>()
  return keep.filter((move) => {
    if (!known.has(move.documentId) || seen.has(move.documentId)) return false
    if (Boolean(move.folderId) === Boolean(move.newFolderPath)) return false
    if (move.folderId && !openFolderIds.has(move.folderId)) return false
    if (move.newFolderPath && !proposed.has(folderPathKey(move.newFolderPath))) return false
    seen.add(move.documentId)
    return true
  })
}

export async function applyRootSort(session: AuthorizedSession, runId: string, keep: readonly KeptMove[]): Promise<RootSortRunView> {
  const run = await ownRun(session, runId)
  const scan = await scanRoot(session, shelfOfRun(run))
  const keptMoves = keptMovesOf(run, keep, new Set(scan.folders.map((folder) => folder.id)))
  if (keptMoves.length === 0) throw new BadRequestError('Nothing to move.')
  const updated = await transition(session, run, ROOT_SORT_LIFECYCLE.sourcesOf('apply'), { status: 'applying', keptMoves, cursor: 0, progressDone: 0 })
  const queued = await enqueueOrRevert(session, updated, ['applying'], { status: 'ready', keptMoves: [], cursor: 0 })
  return viewOf(session, queued)
}

export async function undoRootSort(session: AuthorizedSession, runId: string): Promise<RootSortRunView> {
  const run = await ownRun(session, runId)
  if (run.movedDocuments.length === 0) throw new BadRequestError('The run moved nothing to undo.')
  const updated = await transition(session, run, ROOT_SORT_LIFECYCLE.sourcesOf('undo'), { status: 'undoing', cursor: 0, progressDone: 0 })
  const queued = await enqueueOrRevert(session, updated, ['undoing'], { status: run.status, cursor: 0 })
  return viewOf(session, queued)
}

export async function cancelRootSort(session: AuthorizedSession, runId: string): Promise<RootSortRunView> {
  const run = await ownRun(session, runId)
  const updated = await transition(session, run, ROOT_SORT_LIFECYCLE.sourcesOf('cancel'), {
    status: 'cancelled',
    finishedAt: new Date(),
  })
  return viewOf(session, updated)
}

function progressOf(run: RootSortRun): RootSortRunView['progress'] {
  const done = Math.max(run.cursor, run.progressDone)
  switch (run.status) {
    case 'judging':
      return { done, total: run.documentIds.length }
    case 'grouping':
      return { done: 0, total: leftoversOf(run).length }
    case 'ready':
      return { done: run.documentIds.length, total: run.documentIds.length }
    case 'applying':
      return { done, total: run.keptMoves.length }
    case 'undoing':
      return { done, total: run.movedDocuments.length }
    default:
      return { done: 0, total: 0 }
  }
}

function leftoversOf(run: RootSortRun): string[] {
  const settled = new Set([...run.placements.map((placement) => placement.documentId), ...run.failedDocumentIds])
  return run.documentIds.filter((id) => !settled.has(id)).slice(0, MAX_NEW_FOLDER_DOCUMENTS)
}

async function recentOf(session: AuthorizedSession, run: RootSortRun): Promise<RootSortRunView['recent']> {
  const latest = run.placements.filter((placement) => placement.folderId !== null).slice(-RECENT_PLACEMENTS).reverse()
  if (latest.length === 0) return []
  const shelf = shelfOfRun(run)
  const [rows, paths] = await Promise.all([
    findRootDocuments(session.organizationId, shelf, memberReader(session.userId), latest.map((p) => p.documentId)),
    findShelfFolderPaths(session.organizationId, shelf, latest.flatMap((p) => (p.folderId ? [p.folderId] : []))),
  ])
  const nameOf = new Map(rows.map((row) => [row.id, row.displayName || row.filename]))
  return latest.flatMap((placement) => {
    const name = nameOf.get(placement.documentId)
    const folderPath = placement.folderId ? paths.get(placement.folderId) : undefined
    return name && folderPath ? [{ name, folderPath }] : []
  })
}

export async function viewOf(session: AuthorizedSession, run: RootSortRun): Promise<RootSortRunView> {
  let review: RootSortRunView['review'] = null
  if (run.status === 'ready') {
    const shelf = shelfOfRun(run)
    const [scan, rows] = await Promise.all([
      scanRoot(session, shelf),
      findRootDocuments(session.organizationId, shelf, memberReader(session.userId), run.documentIds),
    ])
    review = {
      folders: scan.folders,
      documents: rows.map((row) => ({ id: row.id, name: row.displayName || row.filename })),
      placements: run.placements,
      newFolders: run.newFolders,
      failedDocumentIds: run.failedDocumentIds,
    }
  }
  const working = ROOT_SORT_WORKING_STATUSES.includes(run.status)
  const [waiting, recent] = await Promise.all([
    working ? isRootSortJobWaiting(session.organizationId, run.jobId) : false,
    run.status === 'judging' ? recentOf(session, run) : [],
  ])
  return {
    id: run.id,
    status: run.status,
    progress: progressOf(run),
    waiting,
    recent,
    unreadable: run.unreadable,
    truncated: run.truncated,
    review,
    moved: run.movedDocuments.length,
    moveFailures: run.moveFailures.slice(0, 50),
    undoFailures: run.undoFailures.slice(0, 50),
    error: run.error,
    groupingError: run.groupingError,
    createdAt: new Date(run.createdAt).toISOString(),
    updatedAt: new Date(run.updatedAt).toISOString(),
  }
}

type Slice = JobSliceResult<RootSortPayload>

function progressReporter(run: RootSortRun): (doneInSlice: number) => Promise<void> {
  let lastWrite = 0
  return async (doneInSlice) => {
    const now = Date.now()
    if (now - lastWrite < PROGRESS_WRITE_MS) return
    lastWrite = now
    try {
      await recordRootSortProgress(
        run.organizationId,
        run.id,
        { status: run.status, cursor: run.cursor },
        run.cursor + doneInSlice
      )
    } catch (error) {
      console.warn(`[root-sort] run ${run.id} could not record its progress`, error)
    }
  }
}

async function judgeSlice(session: AuthorizedSession, run: RootSortRun): Promise<RootSortRunPatch> {
  const shelf = shelfOfRun(run)
  const step = run.documentIds.slice(run.cursor, run.cursor + ROOT_SORT_CHUNK * CHUNKS_PER_SLICE)
  const chunks = Array.from({ length: Math.ceil(step.length / ROOT_SORT_CHUNK) }, (_, index) =>
    step.slice(index * ROOT_SORT_CHUNK, (index + 1) * ROOT_SORT_CHUNK)
  )
  const context = await sortContextFor(session, shelf)
  const report = progressReporter(run)
  let judged = 0
  const plans = await Promise.all(
    chunks.map(async (ids) => {
      const plan = await planRootChunk(session, shelf, ids, context)
      judged += ids.length
      await report(judged)
      return plan
    })
  )
  const cursor = run.cursor + step.length
  return {
    placements: [...run.placements, ...plans.flatMap((plan) => plan.placements)],
    failedDocumentIds: [...run.failedDocumentIds, ...chunks.flatMap((ids, index) => (plans[index].error ? ids : []))],
    cursor,
    status: cursor >= run.documentIds.length ? 'grouping' : 'judging',
  }
}

async function groupSlice(session: AuthorizedSession, run: RootSortRun): Promise<RootSortRunPatch> {
  const leftovers = leftoversOf(run)
  const grouped = leftovers.length >= 2 ? await proposeRootFolders(session, shelfOfRun(run), leftovers) : null
  if (grouped?.error) console.warn(`[root-sort] run ${run.id} was not grouped: ${grouped.error}`)
  return { newFolders: grouped?.proposals ?? [], groupingError: grouped?.error ?? null, status: 'ready' }
}

async function createKeptFolders(session: AuthorizedSession, run: RootSortRun): Promise<KeptMove[]> {
  const paths = [...new Set(run.keptMoves.flatMap((move) => (move.newFolderPath ? [move.newFolderPath] : [])))]
  if (paths.length === 0) return run.keptMoves
  const shelf = shelfOfRun(run)
  const input = { parentId: null, paths }
  const outcome =
    shelf.kind === 'project'
      ? await ensureProjectFolderPaths({ projectId: shelf.projectId, ...input }, session)
      : await ensureOfficeShelfFolderPaths(session, input)
  const idByKey = new Map(
    outcome.ok ? Object.entries(outcome.folderIdByPath).map(([path, id]) => [folderPathKey(path), id]) : []
  )
  if (!outcome.ok) console.warn(`[root-sort] run ${run.id} could not create its folders: ${outcome.error}`)
  return run.keptMoves.map((move) =>
    move.newFolderPath ? { ...move, folderId: idByKey.get(folderPathKey(move.newFolderPath)) ?? null } : move
  )
}

function reached(step: readonly KeptMove[], started: number): number {
  let sent = 0
  let count = 0
  for (const move of step) {
    if (move.folderId && sent === started) break
    if (move.folderId) sent += 1
    count += 1
  }
  return count
}

async function applySlice(session: AuthorizedSession, run: RootSortRun): Promise<RootSortRunPatch> {
  const keptMoves = run.cursor === 0 ? await createKeptFolders(session, run) : run.keptMoves
  const step = keptMoves.slice(run.cursor, run.cursor + MAX_MOVES_PER_SLICE)
  const report = progressReporter(run)
  const outcomes = await moveDocumentsToFolders(
    step.flatMap((move) =>
      move.folderId ? [{ documentId: move.documentId, folderId: move.folderId, expectedFolderId: null }] : []
    ),
    session,
    { deadline: Date.now() + MOVE_SLICE_BUDGET_MS, onProgress: (sent) => report(reached(step, sent)), concurrency: MOVES_IN_FLIGHT }
  )
  const done = reached(step, outcomes.length)
  const handled = step.slice(0, done)
  const folderOf = new Map(handled.map((move) => [move.documentId, move.folderId]))
  const cursor = run.cursor + done
  const finished = cursor >= keptMoves.length
  return {
    keptMoves,
    cursor,
    movedDocuments: [
      ...run.movedDocuments,
      ...outcomes.flatMap((o) => {
        const folderId = folderOf.get(o.documentId)
        return o.ok && o.changed !== false && folderId ? [{ documentId: o.documentId, folderId }] : []
      }),
    ],
    moveFailures: [
      ...run.moveFailures,
      ...handled.flatMap((move) =>
        move.folderId ? [] : [{ documentId: move.documentId, error: 'The new folder could not be created.' }]
      ),
      ...outcomes.flatMap((o) => (o.ok ? [] : [{ documentId: o.documentId, error: o.error ?? 'Move failed.' }])),
    ],
    status: finished ? 'applied' : 'applying',
    finishedAt: finished ? new Date() : null,
  }
}

async function undoSlice(session: AuthorizedSession, run: RootSortRun): Promise<RootSortRunPatch> {
  const step = run.movedDocuments.slice(run.cursor, run.cursor + MAX_MOVES_PER_SLICE)
  const report = progressReporter(run)
  const outcomes = await moveDocumentsToFolders(
    step.map((moved) => ({ documentId: moved.documentId, folderId: null, expectedFolderId: moved.folderId })),
    session,
    { deadline: Date.now() + MOVE_SLICE_BUDGET_MS, onProgress: report, concurrency: MOVES_IN_FLIGHT }
  )
  const cursor = run.cursor + outcomes.length
  const finished = cursor >= run.movedDocuments.length
  return {
    cursor,
    undoFailures: [
      ...run.undoFailures,
      ...outcomes.flatMap((o) => (o.ok ? [] : [{ documentId: o.documentId, error: o.error ?? 'Undo failed.' }])),
    ],
    status: finished ? 'undone' : 'undoing',
    finishedAt: finished ? new Date() : null,
  }
}

const STEPS: Partial<Record<RootSortRunStatus, (session: AuthorizedSession, run: RootSortRun) => Promise<RootSortRunPatch>>> = {
  judging: judgeSlice,
  grouping: groupSlice,
  applying: applySlice,
  undoing: undoSlice,
}

export async function runRootSortSlice(session: AuthorizedSession, payload: RootSortPayload): Promise<Slice> {
  const run = await findRootSortRun(session.organizationId, payload.runId)
  const step = run && run.requestedBy === session.userId ? STEPS[run.status] : undefined
  if (!run || !step) return { done: true, payload }
  let patch: RootSortRunPatch
  try {
    await requireSortable(session, shelfOfRun(run))
    patch = await step(session, run)
  } catch (error) {
    if (!(error instanceof BadRequestError || error instanceof NotFoundError || error instanceof ForbiddenError)) throw error
    const failed = await updateRootSortRun(
      session.organizationId,
      run.id,
      [run.status],
      { status: 'failed', error: error.message, finishedAt: new Date() },
      { cursor: run.cursor }
    )
    if (failed) await announceRootSortRun(failed)
    return { done: true, payload }
  }
  const committed = patch.cursor === undefined ? patch : { ...patch, progressDone: patch.cursor }
  const updated = await updateRootSortRun(session.organizationId, run.id, [run.status], committed, { cursor: run.cursor })
  if (updated && updated.status !== run.status) await announceRootSortRun(updated)
  const working = updated !== null && STEPS[updated.status] !== undefined
  return { done: !working, payload }
}

export async function endRunOfDepartedRequester(organizationId: string, runId: string): Promise<void> {
  await updateRootSortRun(organizationId, runId, ['judging', 'grouping', 'applying', 'undoing'], {
    status: 'failed',
    error: 'requester_left',
    finishedAt: new Date(),
  })
}
