import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isFolderVisibleTo } from '@/lib/authz/folder-access'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { hasPermission, ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { Document } from '@/lib/db/schema/documents'
import {
  hasPassedScreening,
  memberReader,
  REVIEWER_READER,
  type ScreeningFacts,
  type ShelfReader,
} from '@/lib/documents/document-reader'
import { NAME_TAKEN_DETAILS, nameTakenMessage } from '@/lib/documents/name-taken'
import { QUARANTINED_REPLACE_REASON } from './quarantine'

type ReviewedDocument = Pick<Document, 'scope' | 'projectId' | 'folderId'>

export async function mayReviewQuarantine(session: AuthorizedSession, doc: ReviewedDocument): Promise<boolean> {
  if (hasPermission(session, ORG_PERMISSIONS.projectsAdminister)) return true
  if (doc.scope === 'office_shelf') return canManageOfficeShelf(session)
  if (doc.scope !== 'project' || !doc.projectId) return false
  try {
    await requireProjectAccess(session, doc.projectId, 'project:manage')
  } catch {
    return false
  }
  return isFolderVisibleTo(session, doc.projectId, doc.folderId).catch(() => false)
}

export async function maySeeHeld(
  session: AuthorizedSession,
  doc: ReviewedDocument & Pick<Document, 'createdBy'>
): Promise<boolean> {
  return doc.createdBy === session.userId || mayReviewQuarantine(session, doc)
}

export async function shelfReaderFor(
  session: AuthorizedSession,
  place: Pick<Document, 'scope' | 'projectId'>
): Promise<ShelfReader> {
  return (await mayReviewQuarantine(session, { ...place, folderId: null })) ? REVIEWER_READER : memberReader(session.userId)
}

type SupersededDocument = ReviewedDocument & ScreeningFacts & Pick<Document, 'id' | 'createdBy'>

export async function assertMayReplaceHeld(
  session: AuthorizedSession,
  superseded: SupersededDocument,
  filename: string
): Promise<void> {
  if (hasPassedScreening(superseded)) return
  const visible = await maySeeHeld(session, superseded)
  if (visible && superseded.status !== 'quarantined') return
  if (visible) {
    throw new ConflictError(
      `"${filename}" is waiting in quarantine. Delete it, or have it allowed through, before uploading a new version.`,
      { reason: QUARANTINED_REPLACE_REASON, documentId: superseded.id, ownUpload: superseded.createdBy === session.userId }
    )
  }
  throw new ConflictError(nameTakenMessage(filename), NAME_TAKEN_DETAILS)
}
