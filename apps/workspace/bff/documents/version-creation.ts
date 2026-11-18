import 'server-only'
import { ConflictError, ForbiddenError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from './access'
import { findDocumentVersionTransition, type DocumentVersionOp } from './lifecycle-types'
import { OpenVersionExistsError } from './unique-conflicts'
import { runEffects } from './version-effects'
import { requireTransitionPermission } from './version-transition-rules'
import {
  findOpenVersion,
  findPublishedVersion,
  insertDocumentVersion,
  insertPublishedVersion,
} from './version-repository'

export interface CreateVersionInput {
  document: Document
  op: Extract<DocumentVersionOp, 'upload' | 'create'>
  storageKey: string
  storageBucket: string | null
  contentType: string | null
  fileSize: number | null
  contentHash: string | null
  request?: Request
  actingHuman?: boolean
  originConversationId?: string | null
}

export async function createDocumentVersion(
  session: AuthorizedSession,
  input: CreateVersionInput,
): Promise<DocumentVersion> {
  const transition = findDocumentVersionTransition(null, input.op)
  if (!transition) throw new ConflictError(`No transition creates a version by ${input.op}`)
  if (transition.actor === 'human' && input.actingHuman === false) {
    throw new ForbiddenError(`${input.op} is a person's decision`, { op: input.op })
  }
  await requireTransitionPermission(session, input.document, transition)

  const now = new Date()
  const values = {
    organizationId: session.organizationId,
    documentId: input.document.id,
    projectId: input.document.projectId,
    storageKey: input.storageKey,
    storageBucket: input.storageBucket,
    contentType: input.contentType,
    fileSize: input.fileSize,
    contentHash: input.contentHash,
    createdBy: session.userId,
    originConversationId: input.originConversationId ?? null,
    ...(transition.to === 'published'
      ? { state: 'published' as const, origin: 'upload' as const, publishedBy: session.userId, publishedAt: now }
      : { state: transition.to, origin: 'draft' as const }),
  }

  const promoted = transition.promotes ? await insertPublishedVersion(values) : null
  const version = promoted?.version ?? (await insertDocumentVersion(values))

  await runEffects({
    session,
    document: input.document,
    version,
    previous: promoted?.superseded[0] ?? null,
    transition,
    input: { request: input.request, actingHuman: input.actingHuman },
  })
  return version
}

function openVersionConflict(open: DocumentVersion): ConflictError {
  return new ConflictError('This document already has an open version', {
    versionId: open.id,
    state: open.state,
  })
}

export async function forkDraftVersion(
  session: AuthorizedSession,
  documentId: string,
  request?: Request,
): Promise<DocumentVersion> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  const open = await findOpenVersion(documentId, session.organizationId)
  if (open) throw openVersionConflict(open)
  const published = await findPublishedVersion(documentId, session.organizationId)
  const source = published ?? {
    storageKey: document.storageKey,
    storageBucket: document.storageBucket,
    contentType: document.contentType,
    fileSize: document.fileSize,
    contentHash: document.contentHash,
    screenedHash: null,
  }

  const transition = findDocumentVersionTransition(null, 'create')
  if (!transition) throw new ConflictError('No transition creates a draft')
  await requireTransitionPermission(session, document, transition)

  const version = await insertDocumentVersion({
    organizationId: session.organizationId,
    documentId,
    projectId: document.projectId,
    state: 'draft',
    origin: 'draft',
    storageKey: source.storageKey,
    storageBucket: source.storageBucket,
    contentType: source.contentType,
    fileSize: source.fileSize,
    contentHash: source.contentHash,
    screenedHash: source.screenedHash,
    createdBy: session.userId,
  }).catch(async (error: unknown) => {
    if (!(error instanceof OpenVersionExistsError)) throw error
    const winner = await findOpenVersion(documentId, session.organizationId)
    throw winner ? openVersionConflict(winner) : error
  })

  await runEffects({
    session,
    document,
    version,
    previous: published,
    transition,
    input: { request },
  })
  return version
}
