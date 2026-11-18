import { eq } from 'drizzle-orm'
import { ApiError } from '@/lib/api/errors'
import { getDb } from '@/lib/db'
import { documents } from '@/lib/db/schema/documents'
import { getProjectFolderAccess, requireFolderWrite } from '@/lib/authz/folder-access'
import { getBackendUrl } from '@/lib/backend-proxy'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  collectionFileRef,
  collectionFileUrl,
  purgeIngestedChunks,
  type CollectionFileRef,
} from '@/lib/documents/collection-file-ref'
import { IN_FLIGHT_DOCUMENT_STATUSES } from '@/lib/documents/document-status'
import { PURGE_TIMEOUT_MS, placeProjectDocuments } from '@/lib/projects/collection-placement'
import { assertIfcMayBeFiledIn } from '@/lib/projects/ifc-folder-guard'
import { findProjectInOrg } from '@/lib/projects/repository'
import { findDocumentForSession } from './access'
import { reingestDocument } from './reingest'
import { documentShelf, type DocumentShelf } from './shelf'
import { requireShelfWrite } from './shelf-authz'
import { findShelfFolder } from './shelf-folders'
import { publishShelfChanged } from './shelf-live'

const BACKEND_MIRROR_TIMEOUT_MS = 10_000

const FOLDER_NOT_FOUND: Record<DocumentShelf['kind'], string> = {
  project: 'Folder not found in this project.',
  office_shelf: 'Folder not found in the office shelf.',
}

export interface MoveDocumentInput {
  documentId: string
  folderId: string | null
  expectedFolderId?: string | null
}

export interface MoveDocumentResult {
  id: string
  folderId: string | null
}

interface PlacementDue {
  projectId: string
  collectionName: string
}

export type MoveDocumentOutcomeResult =
  | {
      ok: true
      document: MoveDocumentResult
      pending?: boolean
      changed?: boolean
      placementDue?: PlacementDue | null
    }
  | { ok: false; error: string }

export interface MoveDocumentOptions {
  deferPlacement?: boolean
}

export const MOVED_SINCE_MESSAGE = 'The document was moved since; it was left where it is.'

const IN_FLIGHT_MESSAGE =
  'This document is still being processed. Move it across a restriction once processing has finished.'
const PURGE_FAILED_MESSAGE = 'The document could not be removed from its current collection, so it was not moved. Try again.'

export async function moveDocumentToFolder(
  input: MoveDocumentInput,
  session: AuthorizedSession,
  { deferPlacement = false }: MoveDocumentOptions = {},
): Promise<MoveDocumentOutcomeResult> {
  const db = getDb()

  const document = await findDocumentForSession(session, input.documentId)

  if (!document) return { ok: false, error: 'Document not found.' }
  if (input.expectedFolderId !== undefined && document.folderId !== input.expectedFolderId) {
    return { ok: false, error: MOVED_SINCE_MESSAGE }
  }
  const shelf = documentShelf(document)
  if (!shelf) {
    return { ok: false, error: 'Only project and Archiv documents live in folders.' }
  }

  await requireShelfWrite(session, shelf)

  let targetCollection = document.collectionName
  if (shelf.kind === 'project') {
    const project = await findProjectInOrg(shelf.projectId, session.organizationId)
    if (!project) return { ok: false, error: 'Document not found.' }
    const access = await getProjectFolderAccess(session, shelf.projectId, project.collectionName)
    if (!access.isVisible(document.folderId)) return { ok: false, error: 'Document not found.' }
    if (!access.isVisible(input.folderId)) return { ok: false, error: FOLDER_NOT_FOUND.project }
    await requireFolderWrite(session, shelf.projectId, [document.folderId, input.folderId])
    targetCollection = access.collectionFor(input.folderId)
    assertIfcMayBeFiledIn(document.filename, targetCollection, project.collectionName)
  }

  let destinationPath: string | null = null
  if (input.folderId) {
    const folder = await findShelfFolder(shelf, session.organizationId, input.folderId)
    if (!folder) return { ok: false, error: FOLDER_NOT_FOUND[shelf.kind] }
    destinationPath = folder.path
  }

  if (document.folderId === input.folderId) {
    return {
      ok: true,
      document: { id: document.id, folderId: document.folderId },
      pending: false,
      placementDue: null,
      changed: false,
    }
  }

  const crossing = shelf.kind === 'project' && targetCollection !== document.collectionName
  if (crossing) {
    if (IN_FLIGHT_DOCUMENT_STATUSES.has(document.status.toLowerCase())) return { ok: false, error: IN_FLIGHT_MESSAGE }
    const ref = collectionFileRef(document)
    if (ref && !(await purgeIngestedChunks(getBackendUrl(), ref, PURGE_TIMEOUT_MS, { permanent: true }))) {
      return { ok: false, error: PURGE_FAILED_MESSAGE }
    }
  }

  let updated: MoveDocumentResult
  try {
    ;[updated] = await db
      .update(documents)
      .set({ folderId: input.folderId, updatedAt: new Date() })
      .where(eq(documents.id, document.id))
      .returning({ id: documents.id, folderId: documents.folderId })
  } catch (error) {
    if (crossing) await restoreAfterFailedMove(session, document.id)
    throw error
  }
  publishShelfChanged(session.organizationId, shelf)
  const moved: MoveDocumentResult = { id: updated.id, folderId: updated.folderId }

  if (crossing) {
    const placementDue = { projectId: shelf.projectId, collectionName: targetCollection }
    if (deferPlacement) return { ok: true, document: moved, pending: true, placementDue, changed: true }
    await placeProjects(session.organizationId, [shelf.projectId])
    const placed = await isInCollection(session, document.id, targetCollection)
    return { ok: true, document: moved, pending: !placed, placementDue: null, changed: true }
  }

  const backendRef = collectionFileRef({
    id: document.id,
    collectionName: document.collectionName,
    filename: document.filename,
    authoredBy: document.authoredBy,
    authoredByProducer: document.authoredByProducer,
    publishedVersionId: document.publishedVersionId,
  })
  if (backendRef) {
    await mirrorDocumentFolderPath(backendRef, destinationPath)
  }

  return { ok: true, document: moved, pending: false, placementDue: null, changed: true }
}

async function placeProjects(organizationId: string, projectIds: Iterable<string>): Promise<void> {
  for (const projectId of new Set(projectIds)) {
    try {
      await placeProjectDocuments(organizationId, projectId)
    } catch (error) {
      console.warn(`[documents] placement of project ${projectId} failed; the placement sweep finishes it`, error)
    }
  }
}

async function isInCollection(session: AuthorizedSession, documentId: string, collectionName: string): Promise<boolean> {
  const after = await findDocumentForSession(session, documentId)
  return after?.collectionName === collectionName
}

export interface DocumentMoveOutcome {
  documentId: string
  ok: boolean
  error: string | null
  pending?: boolean
  changed?: boolean
}

export interface MoveDocumentsOptions {
  deadline?: number
  onProgress?: (done: number) => Promise<void> | void
  concurrency?: number
}

export async function moveDocumentsToFolders(
  moves: readonly MoveDocumentInput[],
  session: AuthorizedSession,
  { deadline, onProgress, concurrency = 1 }: MoveDocumentsOptions = {},
): Promise<DocumentMoveOutcome[]> {
  const settled: Array<{ outcome: DocumentMoveOutcome; placementDue?: PlacementDue }> = []
  let next = 0
  let done = 0
  const lane = async (): Promise<void> => {
    while (next < moves.length) {
      if (deadline !== undefined && Date.now() >= deadline) return
      const index = next++
      if (done > 0) await onProgress?.(done)
      settled[index] = await moveOne(moves[index], session)
      done += 1
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, moves.length)) }, lane))
  const outcomes = settled.map((item) => item.outcome)
  const crossed = settled.flatMap((item) => (item.placementDue ? [{ outcome: item.outcome, placementDue: item.placementDue }] : []))
  await placeProjects(
    session.organizationId,
    crossed.map((item) => item.placementDue.projectId),
  )
  for (const { outcome, placementDue } of crossed) {
    outcome.pending = !(await isInCollection(session, outcome.documentId, placementDue.collectionName))
  }
  return outcomes
}

async function moveOne(
  move: MoveDocumentInput,
  session: AuthorizedSession,
): Promise<{ outcome: DocumentMoveOutcome; placementDue?: PlacementDue }> {
  try {
    const result = await moveDocumentToFolder(move, session, { deferPlacement: true })
    if (!result.ok) return { outcome: { documentId: move.documentId, ok: false, error: result.error, pending: false } }
    return {
      outcome: {
        documentId: move.documentId,
        ok: true,
        error: null,
        pending: result.pending,
        changed: result.changed ?? true,
      },
      placementDue: result.placementDue ?? undefined,
    }
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(`[documents] move of ${move.documentId} failed`, error)
    return {
      outcome: {
        documentId: move.documentId,
        ok: false,
        error: error instanceof ApiError ? error.message : 'Move failed.',
        pending: false,
      },
    }
  }
}

async function restoreAfterFailedMove(session: AuthorizedSession, documentId: string): Promise<void> {
  try {
    await reingestDocument(session, documentId)
  } catch (error) {
    console.error(`[documents] ${documentId} lost its chunks to a move that failed, and could not be re-read`, error)
  }
}

async function mirrorDocumentFolderPath(ref: CollectionFileRef, folderPath: string | null): Promise<void> {
  try {
    await fetch(collectionFileUrl(getBackendUrl(), ref, '/folder-path'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath }),
      signal: AbortSignal.timeout(BACKEND_MIRROR_TIMEOUT_MS),
    })
  } catch {
    // ignore — see the note above; `documents.folder_id` is the durable truth.
  }
}
