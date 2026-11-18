import 'server-only'
import { randomUUID } from 'node:crypto'
import { BadRequestError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBackendUrl } from '@/lib/backend-proxy'
import type { Document } from '@/lib/db/schema/documents'
import { hasPassedScreening, memberReader, SCREENED_ONLY } from '@/lib/documents/document-reader'
import { reconcileDocumentStatuses } from '@/lib/documents/reconcile-status'
import type { DocumentShelf } from '@/lib/documents/shelf'
import { requireShelfWrite } from '@/lib/documents/shelf-authz'
import { surfaceStateOf } from '@/lib/documents/surface-state'
import { folderPathKey, pathSegments, validateFolderName } from '@/lib/projects/folders'
import { isProjectClosed } from '@/lib/projects/project-status'
import { findProjectInOrg } from '@/lib/projects/repository'
import { z } from 'zod'
import { judgeFiling } from './judge'
import { findRootDocuments, listRootDocuments, listShelfFolderPaths } from './repository'
import {
  MAX_NEW_FOLDERS,
  MAX_ROOT_SORT_DOCUMENTS,
  type NewFolderProposal,
  type NewFolders,
  type RootSortPlacement,
  type RootSortPlan,
  type RootSortScan,
} from './root-sort-types'
import {
  conventionsFor,
  documentInput,
  REASON_LOCALE,
  shelfDocTypes,
  shelfFolders,
  type ShelfFolders,
} from './service'
import { MAX_JUDGED_FOLDERS, type FilingConventionInput, type FilingFolderInput, type FilingMove } from './types'

const NEW_FOLDERS_TIMEOUT_MS = 240_000
const NEW_FOLDER_SUMMARY_CHARS = 300

type EnrichedDocument = Document & { tags?: string[]; summary?: string }

const isJudgeable = (row: Document) => hasPassedScreening(row) && surfaceStateOf(row.status) === 'citable'

export async function requireSortable(session: AuthorizedSession, shelf: DocumentShelf): Promise<void> {
  await requireShelfWrite(session, shelf)
  if (shelf.kind !== 'project') return
  const project = await findProjectInOrg(shelf.projectId, session.organizationId)
  if (!project) throw new BadRequestError('Project not found.')
  if (isProjectClosed(project)) throw new BadRequestError('A closed project is not sorted.')
}

const openFoldersOf = (folders: ShelfFolders) => folders.rows.filter((row) => !folders.isRestricted(row.id))

async function folderSpace(session: AuthorizedSession, shelf: DocumentShelf, folders: ShelfFolders): Promise<FolderSpace> {
  const paths = await listShelfFolderPaths(session.organizationId, shelf)
  return {
    takenKeys: new Set(paths.map(folderPathKey)),
    openKeys: new Set(openFoldersOf(folders).map((row) => folderPathKey(row.path))),
  }
}

export async function scanRoot(session: AuthorizedSession, shelf: DocumentShelf): Promise<RootSortScan> {
  await requireSortable(session, shelf)
  const [folders, rows] = await Promise.all([
    shelfFolders(session, shelf),
    listRootDocuments(session.organizationId, shelf, memberReader(session.userId), MAX_ROOT_SORT_DOCUMENTS + 1),
  ])
  const listed = rows.slice(0, MAX_ROOT_SORT_DOCUMENTS)
  const readable = listed.filter(isJudgeable)
  return {
    folders: openFoldersOf(folders).map(({ id, parentId, name, path }) => ({ id, parentId, name, path })),
    documents: readable.map((row) => ({ id: row.id, name: row.displayName ?? row.filename })),
    unreadable: listed.length - readable.length,
    truncated: rows.length > MAX_ROOT_SORT_DOCUMENTS,
  }
}

async function judgeableRootDocuments(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  documentIds: readonly string[]
): Promise<EnrichedDocument[]> {
  const rows = await findRootDocuments(session.organizationId, shelf, SCREENED_ONLY, documentIds)
  const enriched = await reconcileDocumentStatuses(rows, session.organizationId, 'read')
  return enriched.filter(isJudgeable)
}

async function folderInputs(session: AuthorizedSession, shelf: DocumentShelf, folders: ShelfFolders) {
  const docTypes = await shelfDocTypes(session.organizationId, shelf, folders)
  return openFoldersOf(folders)
    .slice(0, MAX_JUDGED_FOLDERS)
    .map(
      (row): FilingFolderInput => ({
        path: row.path,
        description: row.description,
        docTypes: docTypes.get(folderPathKey(row.path)) ?? [],
      })
    )
}

export interface FolderSpace {
  takenKeys: ReadonlySet<string>
  openKeys: ReadonlySet<string>
}

export function creatablePath(path: string, space: FolderSpace): string | null {
  const segments = pathSegments(path)
  if (segments.length === 0 || !segments.every((segment) => validateFolderName(segment).ok)) return null
  const normalized = segments.join('/')
  const key = folderPathKey(normalized)
  if (space.takenKeys.has(key)) return null
  const parent = folderPathKey(segments.slice(0, -1).join('/'))
  return parent === '' || space.openKeys.has(parent) ? normalized : null
}

export function placementsOf(
  moves: readonly FilingMove[],
  folders: ReadonlyArray<{ id: string; path: string }>,
  space: FolderSpace
): RootSortPlacement[] {
  const idByKey = new Map(folders.map((folder) => [folderPathKey(folder.path), folder.id]))
  return moves.flatMap((move): RootSortPlacement[] => {
    const folderId = idByKey.get(folderPathKey(move.folder)) ?? null
    const newFolderPath = !folderId && move.newFolder ? creatablePath(move.folder, space) : null
    if (!folderId && !newFolderPath) return []
    return [
      {
        documentId: move.documentId,
        folderId,
        newFolderPath,
        reason: move.reason,
        confidence: move.confidence,
      },
    ]
  })
}

export interface SortContext {
  folders: ShelfFolders
  inputs: FilingFolderInput[]
  space: FolderSpace
  conventions: FilingConventionInput[]
}

export async function sortContextFor(session: AuthorizedSession, shelf: DocumentShelf): Promise<SortContext> {
  await requireSortable(session, shelf)
  const folders = await shelfFolders(session, shelf)
  const [inputs, space, conventions] = await Promise.all([
    folderInputs(session, shelf, folders),
    folderSpace(session, shelf, folders),
    shelf.kind === 'project'
      ? conventionsFor(session, shelf.projectId, folders.rows.map((row) => row.path), true)
      : Promise.resolve([]),
  ])
  return { folders, inputs, space, conventions }
}

export async function planRootChunk(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  documentIds: readonly string[],
  context: SortContext
): Promise<RootSortPlan> {
  const documents = await judgeableRootDocuments(session, shelf, documentIds)
  if (documents.length === 0) return { placements: [], error: null, traceId: null }
  const judgement = await judgeFiling(session.organizationId, {
    basis: 'content',
    purpose: 'sort',
    locale: REASON_LOCALE,
    folders: context.inputs,
    conventions: context.conventions,
    documents: documents.map((row) => documentInput(row, context.folders, 'content')),
    trace: {
      batchId: randomUUID(),
      projectId: shelf.kind === 'project' ? shelf.projectId : null,
      shelf: shelf.kind,
    },
  })
  if (judgement.error) return { placements: [], error: judgement.error, traceId: judgement.traceId }
  return {
    placements: placementsOf(judgement.moves, openFoldersOf(context.folders), context.space),
    error: null,
    traceId: judgement.traceId,
  }
}

const folderProposalsResponseSchema = z.object({
  proposals: z
    .array(
      z.object({
        path: z.string(),
        description: z.string().nullish(),
        ids: z.array(z.string()),
        confidences: z.record(z.string(), z.number().min(0).max(1)).default({}),
      })
    )
    .default([]),
  error: z.string().nullish(),
  trace_id: z.string().nullish(),
})

type RawFolderProposal = z.infer<typeof folderProposalsResponseSchema>['proposals'][number]

export function keepNewFolders(
  proposals: readonly RawFolderProposal[],
  space: FolderSpace,
  documentIds: readonly string[]
): NewFolderProposal[] {
  const known = new Set(documentIds)
  const taken = new Set<string>()
  const kept: NewFolderProposal[] = []
  for (const proposal of proposals) {
    const path = creatablePath(proposal.path, space)
    if (!path) continue
    const key = folderPathKey(path)
    if (kept.some((other) => folderPathKey(other.path) === key)) continue
    const ids = [...new Set(proposal.ids)].filter((id) => known.has(id) && !taken.has(id))
    if (ids.length < 2) continue
    ids.forEach((id) => taken.add(id))
    const confidences = Object.fromEntries(
      ids.flatMap((id) => (id in proposal.confidences ? [[id, proposal.confidences[id]]] : []))
    )
    kept.push({ path, description: proposal.description?.trim().slice(0, 500) || null, documentIds: ids, confidences })
    if (kept.length === MAX_NEW_FOLDERS) break
  }
  return kept
}

export async function proposeRootFolders(
  session: AuthorizedSession,
  shelf: DocumentShelf,
  documentIds: readonly string[]
): Promise<NewFolders> {
  await requireSortable(session, shelf)
  const [folders, documents] = await Promise.all([
    shelfFolders(session, shelf),
    judgeableRootDocuments(session, shelf, documentIds),
  ])
  if (documents.length < 2) return { proposals: [], error: null, traceId: null }
  const [inputs, space] = await Promise.all([folderInputs(session, shelf, folders), folderSpace(session, shelf, folders)])
  const body = {
    locale: REASON_LOCALE,
    folders: inputs.map((folder) => ({ path: folder.path, description: folder.description, doc_types: folder.docTypes })),
    documents: documents.map((row) => {
      const input = documentInput(row, folders, 'content')
      return {
        id: input.id,
        file: input.file,
        type: input.type,
        tags: input.tags,
        summary: input.summary?.slice(0, NEW_FOLDER_SUMMARY_CHARS) ?? null,
      }
    }),
    trace: {
      batch_id: randomUUID(),
      project_id: shelf.kind === 'project' ? shelf.projectId : null,
      shelf: shelf.kind,
    },
  }
  try {
    const response = await fetch(`${getBackendUrl()}/v1/folder-proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-organization-id': session.organizationId },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(NEW_FOLDERS_TIMEOUT_MS),
    })
    if (!response.ok) return { proposals: [], error: `backend_${response.status}`, traceId: null }
    const parsed = folderProposalsResponseSchema.safeParse(await response.json())
    if (!parsed.success) return { proposals: [], error: 'response_malformed', traceId: null }
    const { proposals, error, trace_id: traceId } = parsed.data
    if (error) return { proposals: [], error, traceId: traceId ?? null }
    const kept = keepNewFolders(
      proposals,
      space,
      documents.map((row) => row.id)
    )
    return { proposals: kept, error: null, traceId: traceId ?? null }
  } catch {
    return { proposals: [], error: 'backend_unreachable', traceId: null }
  }
}
