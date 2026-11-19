import 'server-only'
import { ApiError } from '@/lib/api/api-error'
import { ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import {
  FOLDER_NORMS_PAGE,
  FOLDER_NORMS_PER_REQUEST,
  type DecideFolderNormsBody,
  type FolderNorm,
  type FolderNorms,
  type FolderNormsDecision,
  type ListFolderNormsQuery,
} from '@/lib/office-shelf/folder-norms-wire'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { requireOfficeStandardsEnabled } from './access'
import { standardsRoot } from './folders'
import { keepAsOrdinaryFiles, listUndecidedFolderFiles } from './folder-norms-repository'
import { rescanNorms } from './folder-norms-scan'
import { recognizeNorm } from './reading'
import { proposeBaseKnowledge } from './service'

export const FOLDER_FILES_READ = 500

function requireFolderNorms(session: AuthorizedSession): void {
  requireOfficeStandardsEnabled(session)
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
}

async function normsIn(session: AuthorizedSession, folderId: string): Promise<FolderNorm[]> {
  requireFolderNorms(session)
  const reader = await shelfReaderFor(session, { scope: 'office_shelf', projectId: null })
  const files = await listUndecidedFolderFiles(session.organizationId, reader, { folderId, limit: FOLDER_FILES_READ })
  return files.flatMap((file): FolderNorm[] => {
    const recognition = recognizeNorm({ fileName: file.fileName })
    return recognition.norm ? [{ documentId: file.id, fileName: file.fileName, designation: recognition.designation }] : []
  })
}

export async function listFolderNorms(
  session: AuthorizedSession,
  folderId: string,
  query: Partial<ListFolderNormsQuery> = {},
): Promise<FolderNorms> {
  const norms = await normsIn(session, folderId)
  const start = query.cursor ? Number(query.cursor) : 0
  const end = start + (query.limit ?? FOLDER_NORMS_PAGE)
  return { folderId, total: norms.length, norms: norms.slice(start, end), nextCursor: end < norms.length ? String(end) : null }
}

async function recordNorm(session: AuthorizedSession, norm: FolderNorm, from: string, to: string): Promise<void> {
  await proposeBaseKnowledge(session, { documentId: norm.documentId })
  const moved = await moveDocumentToFolder({ documentId: norm.documentId, folderId: to, expectedFolderId: from }, session)
  if (!moved.ok) throw new UnprocessableError(moved.error)
}

export async function decideFolderNorms(
  session: AuthorizedSession,
  folderId: string,
  { action }: DecideFolderNormsBody,
): Promise<FolderNormsDecision> {
  const norms = await normsIn(session, folderId)
  if (norms.length === 0) return { action, done: [], failed: [], remaining: 0 }
  if (action === 'keep') {
    await keepAsOrdinaryFiles(session.organizationId, norms.map((norm) => norm.documentId), session.userId)
    await rescanNorms(session.organizationId)
    return { action, done: norms, failed: [], remaining: 0 }
  }
  const batch = norms.slice(0, FOLDER_NORMS_PER_REQUEST)
  const root = await standardsRoot(session.organizationId)
  const done: FolderNorm[] = []
  const failed: FolderNormsDecision['failed'] = []
  for (const norm of batch) {
    try {
      await recordNorm(session, norm, folderId, root.id)
      done.push(norm)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      failed.push({ ...norm, error: error.message })
    }
  }
  await rescanNorms(session.organizationId)
  return { action, done, failed, remaining: norms.length - batch.length }
}
