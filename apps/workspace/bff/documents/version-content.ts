import { documentShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import 'server-only'
import { randomUUID } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { ConflictError, InsufficientStorageError, NotFoundError } from '@/lib/api/errors'
import { markingIsInBytes, type AiProvenanceMarking } from '@/lib/ai-provenance'
import type { AuthorizedSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import { filedInOf } from '@/lib/audit/document-names'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getBackendUrl } from '@/lib/backend-proxy'
import { placementCollectionFor } from '@/lib/authz/folder-access'
import { findConversationInOrg } from '@/lib/conversations/repository'
import { admitRestrictedUse } from '@/lib/conversations/restricted-use'
import { findProjectCollectionName } from '@/lib/projects/repository'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { bucketAdminS3Client, s3Client } from '@/lib/s3'
import { discardObject } from '@/lib/storage/discard'
import {
  assertWithinStorageQuota,
  getStorageQuotaBytes,
  STORAGE_QUOTA_EXCEEDED_MESSAGE,
} from '@/lib/storage/service'
import { ensureTenantBucketChecked, resolveDocumentBucket } from '@/lib/storage/bucket'
import { recordDocumentAccess } from '@/lib/download-log/service'
import { getAccessibleDocument } from './access'
import { stopReadBeforeArchive } from './archive-read-stop'
import { contentDisposition } from './content-disposition'
import { AGENT_DOCUMENT_MEDIA_TYPE, renderAgentDocumentMarkdown } from './agent-document-markdown'
import { resolveDocumentBranding, type DocumentBranding } from './branding'
import { collectionFileRef, purgeIngestedChunks } from './collection-file-ref'
import { contentDigest } from './content-digest'
import { documentDisplayName } from './display-name'
import {
  generatedDocumentMarking,
  UnmarkedRenderingError,
  type GeneratedDocumentProducer,
  type GeneratedRendering,
} from './generated'
import type { DocumentVersionState } from './lifecycle-types'
import { findDocumentInOrg, markDocumentNotIndexed } from './repository'
import { hasPassedScreening, SCREENED_ONLY, versionBytesPassedScreening } from '@/lib/documents/document-reader'
import { maySeeHeld } from '@/lib/upload-screening/quarantine-reviewers'
import {
  findDocumentVersion,
  findDocumentVersionInOrg,
  setDocumentLifecycle,
  swapVersionContent,
  type SwapVersionContentOutcome,
} from './version-repository'

export const BACKEND_PURGE_TIMEOUT_MS = 10_000

export function newVersionWriteId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

export function versionWriteKey(key: string, versionNumber: number, writeId: string): string {
  const segment = `v${versionNumber}/${writeId}`
  const underDoc = /^(.*\/doc\/[^/]+)\/(?:.+\/)?([^/]+)$/.exec(key)
  if (underDoc) return `${underDoc[1]}/${segment}/${underDoc[2]}`
  return key.replace(/\/?([^/]+)$/, (_match, name: string) =>
    key.includes('/') ? `/${segment}/${name}` : `${segment}/${name}`,
  )
}

export function versionMirrorsItem(document: Document, version: DocumentVersion): boolean {
  if (document.publishedVersionId) return document.publishedVersionId === version.id
  return version.versionNumber === 1
}

type VersionRenderer = (
  body: string,
  marking: AiProvenanceMarking,
  branding: DocumentBranding,
) => GeneratedRendering

const PRODUCER_RENDERERS: Partial<Record<GeneratedDocumentProducer, VersionRenderer>> = {
  agent_document: renderAgentDocumentMarkdown,
}

export interface RenderedVersionBytes {
  bytes: Buffer
  contentType: string
  contentHash: string
}

export async function renderVersionBytes(
  document: Document,
  version: DocumentVersion,
  content: string,
  stage: { filed: boolean } = { filed: false },
): Promise<RenderedVersionBytes> {
  if (document.authoredBy !== 'user' && document.authoredByProducer === 'agent_file') {
    throw new ConflictError('This draft is a file the agent made; replace it with update_file, not with text', {
      producer: document.authoredByProducer,
    })
  }
  const renderer =
    document.authoredBy === 'user'
      ? undefined
      : PRODUCER_RENDERERS[document.authoredByProducer as GeneratedDocumentProducer]

  if (!renderer) {
    const bytes = Buffer.from(content, 'utf8')
    return {
      bytes,
      contentType: version.contentType ?? 'text/markdown',
      contentHash: contentDigest(bytes),
    }
  }

  const producer = document.authoredByProducer as GeneratedDocumentProducer
  const marking = generatedDocumentMarking(producer, document.authoredByRef ?? document.id)
  const organizationName = await getOrganizationDisplayName(document.organizationId)
  const branding = await resolveDocumentBranding({
    organizationId: document.organizationId,
    organizationName,
    filed: stage.filed,
  })
  const rendered = renderer(content, marking, branding)
  if (!markingIsInBytes(rendered.bytes, marking)) {
    throw new UnmarkedRenderingError(producer, rendered.contentType)
  }
  const bytes = Buffer.from(rendered.bytes)
  return {
    bytes,
    contentType: rendered.contentType || AGENT_DOCUMENT_MEDIA_TYPE,
    contentHash: contentDigest(bytes),
  }
}

export function versionReplacementCharge(
  document: Document,
  version: DocumentVersion,
  incomingBytes: number,
): number {
  const sharesPublishedObject =
    version.storageKey === document.storageKey && !versionMirrorsItem(document, version)
  if (sharesPublishedObject) return incomingBytes
  return incomingBytes - (version.fileSize ?? 0)
}

export async function admitVersionBytes(
  organizationId: string,
  document: Document,
  version: DocumentVersion,
  incomingBytes: number,
): Promise<void> {
  const charge = versionReplacementCharge(document, version, incomingBytes)
  if (charge <= 0) return
  await assertWithinStorageQuota(organizationId, charge)
}

export interface WriteVersionContentInput {
  organizationId: string
  document: Document
  version: DocumentVersion
  rendered: RenderedVersionBytes
  stamp: Record<string, unknown>
}

export async function writeVersionContent(input: WriteVersionContentInput): Promise<DocumentVersion> {
  const { organizationId, document, version, rendered } = input
  await admitVersionBytes(organizationId, document, version, rendered.bytes.byteLength)
  const quotaBytes = await getStorageQuotaBytes(organizationId)

  const storageBucket = await resolveVersionBucket(organizationId)
  const storageKey = versionWriteKey(document.storageKey, version.versionNumber, newVersionWriteId())
  await s3Client.send(
    new PutObjectCommand({
      Bucket: storageBucket,
      Key: storageKey,
      Body: rendered.bytes,
      ContentType: rendered.contentType,
    }),
  )

  let outcome: SwapVersionContentOutcome
  try {
    outcome = await swapVersionContent({
      versionId: version.id,
      documentId: document.id,
      organizationId,
      expected: {
        state: version.state,
        storageKey: version.storageKey,
        contentHash: version.contentHash,
      },
      patch: {
        ...input.stamp,
        storageKey,
        storageBucket,
        contentType: rendered.contentType,
        fileSize: rendered.bytes.byteLength,
        contentHash: rendered.contentHash,
      },
      mirrorsItem: versionMirrorsItem(document, version),
      quotaBytes,
    })
  } catch (error) {
    await discardObject(storageBucket, storageKey)
    throw error
  }

  if (!outcome.ok) {
    await discardObject(storageBucket, storageKey)
    if (outcome.reason === 'quota') {
      throw new InsufficientStorageError(STORAGE_QUOTA_EXCEEDED_MESSAGE, {
        quotaBytes: quotaBytes ?? 0,
        usedBytes: outcome.usedBytes,
        requestedBytes: rendered.bytes.byteLength,
      })
    }
    throw new ConflictError('The version changed while you were writing', {
      contentHash: version.contentHash,
    })
  }
  if (outcome.previousKeyOrphaned) {
    await discardObject(resolveDocumentBucket(version.storageBucket), version.storageKey)
  }
  publishShelfChanged(organizationId, documentShelf(document))
  return outcome.version
}

export async function resolveVersionBucket(organizationId: string): Promise<string> {
  return ensureTenantBucketChecked(bucketAdminS3Client, organizationId)
}

async function readObjectText(
  storageBucket: string | null,
  storageKey: string,
): Promise<string> {
  const object = await s3Client.send(
    new GetObjectCommand({ Bucket: resolveDocumentBucket(storageBucket), Key: storageKey }),
  )
  const body = await object.Body?.transformToString('utf8')
  if (body === undefined) throw new NotFoundError('Version content not available')
  return body
}

type VersionScreening = Pick<DocumentVersion, 'state' | 'contentHash' | 'screenedHash'>

export async function mayReceiveVersionBytes(
  session: AuthorizedSession,
  document: Document,
  version: VersionScreening,
): Promise<boolean> {
  if (versionBytesPassedScreening(document, version)) return true
  return maySeeHeld(session, document)
}

export async function versionBytesReadableBy(
  session: AuthorizedSession,
  document: Document,
  versions: readonly (VersionScreening & Pick<DocumentVersion, 'id'>)[],
): Promise<(version: VersionScreening) => boolean> {
  const judged = (version: VersionScreening) => versionBytesPassedScreening(document, version)
  if (versions.every(judged)) return judged
  const seesHeld = await maySeeHeld(session, document)
  return (version) => seesHeld || judged(version)
}

async function fetchVersionText(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
  { forModel = false }: { forModel?: boolean } = {},
): Promise<{ document: Document; text: string }> {
  const document = await getAccessibleDocument(session, documentId, 'read')
  if (forModel && !hasPassedScreening(document)) throw new NotFoundError('Version not found')
  const version = await findDocumentVersion(versionId, documentId, session.organizationId)
  if (!version) throw new NotFoundError('Version not found')
  const passed = forModel
    ? versionBytesPassedScreening(document, version)
    : await mayReceiveVersionBytes(session, document, version)
  if (!passed) throw new NotFoundError('Version not found')
  return { document, text: await readObjectText(version.storageBucket, version.storageKey) }
}

export async function readVersionContent(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
): Promise<string> {
  const { document, text } = await fetchVersionText(session, documentId, versionId)
  await recordDocumentAccess(session, document, 'version', { versionId })
  return text
}

const TIMELINE_BYTES_STATES: ReadonlySet<DocumentVersionState> = new Set(['published', 'superseded'])

const INLINE_VERSION_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

export async function streamVersionFile(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
  { download = false }: { download?: boolean } = {},
): Promise<Response> {
  const document = await getAccessibleDocument(session, documentId, 'read')
  const version = await findDocumentVersion(versionId, documentId, session.organizationId)
  if (!version || !TIMELINE_BYTES_STATES.has(version.state)) throw new NotFoundError('Version not found')
  if (!(await mayReceiveVersionBytes(session, document, version))) throw new NotFoundError('Version not found')

  let body
  try {
    const object = await s3Client.send(
      new GetObjectCommand({ Bucket: resolveDocumentBucket(version.storageBucket), Key: version.storageKey }),
    )
    body = object.Body
  } catch {
    throw new NotFoundError('Version not found')
  }
  if (!body) throw new NotFoundError('Version not found')
  await recordDocumentAccess(session, document, 'version', { versionId })

  const stored = version.contentType ?? document.contentType ?? ''
  const inline = !download && INLINE_VERSION_CONTENT_TYPES.has(stored)
  return new Response(body.transformToWebStream(), {
    status: 200,
    headers: {
      'Content-Type': INLINE_VERSION_CONTENT_TYPES.has(stored) ? stored : 'application/octet-stream',
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', document.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
      ...(inline ? { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'" } : {}),
    },
  })
}

export async function readVersionTextForTask(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
): Promise<string> {
  return (await fetchVersionText(session, documentId, versionId, { forModel: true })).text
}

export interface ServiceReader {
  askerUserId: string | null
  answerMessageId: string | null
}

export async function admitSubjectRead(
  document: Document,
  organizationId: string,
  conversationId: string,
  { askerUserId, answerMessageId }: ServiceReader,
): Promise<boolean> {
  if (!document.projectId || !document.folderId) return false
  const projectCollection = await findProjectCollectionName(document.projectId, organizationId)
  if (!projectCollection) return false
  const collection = await placementCollectionFor(
    organizationId,
    document.projectId,
    projectCollection,
    document.folderId,
  )
  if (collection === projectCollection) return false
  if (!askerUserId) throw new NotFoundError('Version not found')
  const admission = await admitRestrictedUse(
    { organizationId, conversationId, userId: askerUserId, projectId: document.projectId, answerMessageId },
    [collection],
  )
  if (admission.refused.length > 0) throw new NotFoundError('Version not found')
  return admission.admitted.length > 0
}

export async function readVersionForService(
  versionId: string,
  organizationId: string,
  conversationId: string,
  reader: ServiceReader = { askerUserId: null, answerMessageId: null },
): Promise<{
  documentId: string
  versionId: string
  versionNumber: number
  state: DocumentVersionState
  contentHash: string | null
  contentType: string | null
  filename: string
  displayName: string
  content: string
  drewOnRestrictedFolder: boolean
}> {
  const version = await findDocumentVersionInOrg(versionId, organizationId)
  if (!version) throw new NotFoundError('Version not found')
  const conversation = await findConversationInOrg(conversationId, organizationId)
  if (
    !conversation ||
    conversation.subjectResourceType !== 'document' ||
    conversation.subjectResourceId !== version.documentId
  ) {
    throw new NotFoundError('Version not found')
  }
  const document = await findDocumentInOrg(version.documentId, organizationId, SCREENED_ONLY)
  if (!document || !versionBytesPassedScreening(document, version)) throw new NotFoundError('Version not found')
  const drewOnRestrictedFolder = await admitSubjectRead(document, organizationId, conversationId, reader)
  return {
    documentId: version.documentId,
    versionId: version.id,
    versionNumber: version.versionNumber,
    state: version.state,
    contentHash: version.contentHash,
    contentType: version.contentType,
    filename: document.filename,
    displayName: documentDisplayName(document),
    content: await readObjectText(version.storageBucket, version.storageKey),
    drewOnRestrictedFolder,
  }
}

export async function archiveDocument(
  session: AuthorizedSession,
  documentId: string,
  request?: Request,
): Promise<{ documentId: string; lifecycle: 'archived' }> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  if (document.projectId) {
    await requireProjectAccess(session, document.projectId, ['project:documents:write', 'project:edit'])
  }
  const readStopped = await stopReadBeforeArchive(session, document)
  await setDocumentLifecycle(documentId, session.organizationId, 'archived')
  publishShelfChanged(session.organizationId, documentShelf(document))
  const purgeRef = collectionFileRef(document)
  const chunksPurged = purgeRef
    ? await purgeIngestedChunks(getBackendUrl(), purgeRef, BACKEND_PURGE_TIMEOUT_MS)
    : null
  await markDocumentNotIndexed(documentId, session.organizationId)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'document.archived',
    targetType: 'document',
    targetId: documentId,
    filedIn: filedInOf(document),
    metadata: {
      projectId: document.projectId ?? '',
      filename: document.filename.slice(0, 200),
      collectionName: document.collectionName,
      chunksPurged,
      readStopped,
    },
    request,
  })
  return { documentId, lifecycle: 'archived' }
}
