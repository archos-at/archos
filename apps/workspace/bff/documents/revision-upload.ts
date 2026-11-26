import 'server-only'
import { z } from 'zod'
import { BadRequestError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from './access'
import { collectionFileRef } from './collection-file-ref'
import { hasPassedScreening, SCREENED_ONLY } from './document-reader'
import { findDocumentInOrg } from './repository'
import { holdsDocumentName } from './name-match'
import { documentShelf, shelfKey, type DocumentShelf } from './shelf'

const olderIdSchema = z.guid()

export function readRevisionOf(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = olderIdSchema.safeParse(value.trim())
  if (!parsed.success) throw new BadRequestError('revisionOf must be a document id', { reason: 'invalid_revision_of' })
  return parsed.data
}

export interface RevisionUploadTarget {
  shelf: DocumentShelf
  collectionName: string
  folderId: string | null
  filename: string
}

function sameShelf(a: DocumentShelf, b: DocumentShelf | null): boolean {
  if (!b || a.kind !== b.kind) return false
  return shelfKey(a) === shelfKey(b)
}

export const REVISION_OF_IGNORED_REASONS = ['unavailable', 'different_shelf', 'archived', 'different_collection'] as const
export type RevisionOfIgnoredReason = (typeof REVISION_OF_IGNORED_REASONS)[number]

export interface ResolvedRevisionOf {
  revisionOf: string | null
  ignored: RevisionOfIgnoredReason | null
}

const NOTHING: ResolvedRevisionOf = { revisionOf: null, ignored: null }
const ignoredFor = (reason: RevisionOfIgnoredReason): ResolvedRevisionOf => ({ revisionOf: null, ignored: reason })

async function olderForLinking(session: AuthorizedSession, olderId: string) {
  try {
    return await getAccessibleDocument(session, olderId, 'write')
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return null
    throw error
  }
}

export async function resolveRevisionOf(
  session: AuthorizedSession,
  olderId: string | null | undefined,
  target: RevisionUploadTarget,
): Promise<ResolvedRevisionOf> {
  if (!olderId) return NOTHING
  const older = await olderForLinking(session, olderId)
  if (!older) return ignoredFor('unavailable')
  return linkableRevisionOf(older, target)
}

export async function resolveReleasedRevisionOf(
  organizationId: string,
  olderId: string,
  released: Pick<Document, 'scope' | 'projectId' | 'ownerUserId' | 'collectionName' | 'folderId' | 'filename'>,
): Promise<string | null> {
  const older = await findDocumentInOrg(olderId, organizationId, SCREENED_ONLY)
  const shelf = documentShelf(released)
  if (!older || !shelf) return null
  return linkableRevisionOf(older, {
    shelf,
    collectionName: released.collectionName,
    folderId: released.folderId,
    filename: released.filename,
  }).revisionOf
}

function linkableRevisionOf(older: Document, target: RevisionUploadTarget): ResolvedRevisionOf {
  if (!hasPassedScreening(older)) return ignoredFor('unavailable')
  if (!sameShelf(target.shelf, documentShelf(older))) return ignoredFor('different_shelf')
  if (older.lifecycle !== 'active') return ignoredFor('archived')
  if (older.collectionName !== target.collectionName) return ignoredFor('different_collection')
  if (!collectionFileRef(older)) return ignoredFor('unavailable')
  if ((older.folderId ?? null) === target.folderId && holdsDocumentName(older, target.filename)) return NOTHING
  return { revisionOf: older.filename, ignored: null }
}
