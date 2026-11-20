import { documentShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import 'server-only'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import {
  AGENT_REFUSAL_LOCALE,
  confinementRefusal,
  folderRestrictsReading,
  requireMayFileFrom,
  type ConversationOrigin,
} from '@/lib/conversations/restricted-egress'
import { findProjectInOrg } from '@/lib/projects/repository'
import { getAccessibleDocument } from './access'
import { hasPassedScreening, internalRead } from '@/lib/documents/document-reader'
import { findDocumentInOrg } from './repository'
import { DocumentDeletedError } from './unique-conflicts'
import { discardObject } from '@/lib/storage/discard'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { renderVersionBytes, writeVersionContent, type RenderedVersionBytes } from './version-content'
import type { Document } from '@/lib/db/schema/documents'
import { DOCUMENT_VERSION_TRANSITIONS, findDocumentVersionTransition, type DocumentVersionOp } from './lifecycle-types'
import { runEffects, type TransitionInput } from './version-effects'
import {
  assertGuards,
  assertReviewGuards,
  requireTransitionPermission,
  reviewRoundFor,
  stampFor,
} from './version-transition-rules'
import { createDocumentVersion, forkDraftVersion } from './version-creation'
import {
  compareAndSwapVersionState,
  findDocumentVersion,
  nextVersionNumber,
  promoteVersionToPublished,
  type DocumentVersionSummary,
} from './version-repository'

export { toDocumentVersionView } from './version-view'
export type { CreateVersionInput } from './version-creation'
export { redispatchPublishedVersion } from './version-ingest'
export {
  getDocumentVersionView,
  listDocumentVersionViews,
  listReviewQueueViews,
  summarizeDocumentVersions,
} from './version-queries'

export async function transitionDocumentVersion(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
  op: DocumentVersionOp,
  input: TransitionInput = {},
): Promise<DocumentVersion> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  const version = await findDocumentVersion(versionId, documentId, session.organizationId)
  if (!version) throw new NotFoundError('Version not found')

  const transition = findDocumentVersionTransition(version.state, op)
  if (!transition) {
    throw new ConflictError(`Cannot ${op} a version that is ${version.state}`, {
      state: version.state,
      op,
    })
  }

  assertGuards(session, version, transition, input)
  await requireTransitionPermission(session, document, transition)
  if (transition.effects.includes('openReviewInbox') && !hasPassedScreening(document)) {
    throw new ConflictError('The document has not passed screening yet', { op, reason: 'held' })
  }
  const review = await assertReviewGuards(session, document, version, transition, input)
  if (input.delegateRevision === true && transition.effects.includes('openRevisionTask')) {
    if (await folderRestrictsReading(session.organizationId, document.projectId, document.folderId)) {
      throw confinementRefusal('revision', input.locale ?? AGENT_REFUSAL_LOCALE)
    }
  }
  const effectInput: TransitionInput = {
    ...input,
    ...(review.reviewers ? { reviewerUserIds: review.reviewers } : {}),
    selfReview: review.selfReview,
  }

  const stamp = stampFor(transition, session, effectInput, new Date())
  const round = reviewRoundFor(transition.op, session, effectInput)
  const promoted = transition.promotes
    ? await promoteVersionToPublished(
        versionId,
        documentId,
        session.organizationId,
        version.state,
        stamp,
        round,
      )
    : null
  const swapped = transition.promotes
    ? (promoted?.version ?? null)
    : await compareAndSwapVersionState(versionId, session.organizationId, version.state, stamp, round)
  if (!swapped) {
    throw new ConflictError('The version changed while you were deciding', { op })
  }
  publishShelfChanged(session.organizationId, documentShelf(document))

  await runEffects({
    session,
    document,
    version: swapped,
    previous: promoted?.superseded[0] ?? null,
    transition,
    input: effectInput,
  })
  return swapped
}

export interface ReplaceVersionOptions {
  request?: Request
  actingHuman?: boolean
  origin?: ConversationOrigin
  versionFields?: { changeNote: string | null }
}

type VersionBytesRenderer = (document: Document, version: DocumentVersion) => Promise<RenderedVersionBytes>

export async function replaceVersionContent(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
  content: string,
  ifMatch: string | null | undefined,
  options: ReplaceVersionOptions = {},
): Promise<DocumentVersion> {
  return replaceVersionFile(session, documentId, versionId, ifMatch, options, (document, version) =>
    renderVersionBytes(document, version, content),
  )
}

export async function replaceVersionFile(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
  ifMatch: string | null | undefined,
  options: ReplaceVersionOptions,
  render: VersionBytesRenderer,
): Promise<DocumentVersion> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  const version = await findDocumentVersion(versionId, documentId, session.organizationId)
  if (!version) throw new NotFoundError('Version not found')

  const transition = findDocumentVersionTransition(version.state, 'update')
  if (!transition) {
    throw new ConflictError(`Cannot replace the content of a version that is ${version.state}`, {
      state: version.state,
    })
  }
  assertGuards(session, version, transition, { ifMatch, actingHuman: options.actingHuman })
  await requireTransitionPermission(session, document, transition)
  if (options.origin) {
    const project = document.projectId ? await findProjectInOrg(document.projectId, session.organizationId) : null
    await requireMayFileFrom(options.origin, {
      organizationId: session.organizationId,
      projectId: project ? project.id : null,
      projectCollection: project?.collectionName ?? document.collectionName,
      folderId: document.folderId,
    })
  }

  const rendered = await render(document, version)
  const swapped = await writeVersionContent({
    organizationId: session.organizationId,
    document,
    version,
    rendered,
    stamp: {
      ...stampFor(transition, session, {}, new Date()),
      ...(options.versionFields ?? {}),
      ...(options.origin?.conversationId ? { originConversationId: options.origin.conversationId } : {}),
    },
  })

  await runEffects({
    session,
    document,
    version: swapped,
    previous: null,
    transition,
    input: { request: options.request, actingHuman: options.actingHuman },
  })
  return swapped
}

export async function recordUploadedVersion(
  session: AuthorizedSession,
  documentId: string,
  request?: Request,
  stored?: UploadedBytes,
): Promise<DocumentVersion | null> {
  const document = await findDocumentInOrg(documentId, session.organizationId, internalRead('just-written'))
  if (!document) return null
  const bytes = stored ?? document
  try {
    return await createDocumentVersion(session, {
      document,
      op: 'upload',
      storageKey: bytes.storageKey,
      storageBucket: bytes.storageBucket,
      contentType: bytes.contentType,
      fileSize: bytes.fileSize,
      contentHash: bytes.contentHash,
      request,
    })
  } catch (error) {
    if (error instanceof DocumentDeletedError) return null
    throw error
  }
}

type UploadedBytes = Pick<
  DocumentVersion,
  'storageKey' | 'storageBucket' | 'contentType' | 'fileSize' | 'contentHash'
>

export async function recordUploadedVersionOrDiscard(
  session: AuthorizedSession,
  documentId: string,
  request: Request | undefined,
  stored: UploadedBytes,
): Promise<DocumentVersion> {
  const version = await recordUploadedVersion(session, documentId, request, stored)
  if (version) return version
  await discardObject(resolveDocumentBucket(stored.storageBucket), stored.storageKey)
  throw new DocumentDeletedError(documentId)
}

export { nextVersionNumber }
export { createDocumentVersion, forkDraftVersion }
export type { TransitionInput }
export { DOCUMENT_VERSION_TRANSITIONS }
export type { DocumentVersionSummary }
