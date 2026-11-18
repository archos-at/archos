import 'server-only'
import { requireFolderWrite } from '@/lib/authz/folder-access'
import { recordAuditEvent } from '@/lib/audit/service'
import { filedInOf } from '@/lib/audit/document-names'
import { getBackendUrl } from '@/lib/backend-proxy'
import { BadRequestError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import { ALLOWED_TAGS, MAX_TOPICS, MAX_TOPIC_LENGTH } from './tag-vocabulary'
import { deleteAssignmentsForResource } from '@/lib/assignments/repository'
import { purgeResourceCollaboration } from '@/lib/collaboration/cleanup'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { documentShelf, projectShelf } from './shelf'
import { publishShelfChanged } from './shelf-live'
import { collectionFileRef, collectionFileUrl, purgeIngestedChunks } from './collection-file-ref'
import { deleteProjectDocument, setDocumentDisplayName } from './repository'
import { documentDisplayName, validateDocumentName } from './display-name'
import { findDocumentForSession, getAccessibleDocument } from './access'
import { eraseDocumentObjectsOrKeepRow } from './object-cleanup'
import { refreshSearchRows } from '@/lib/search/refresh-rows'
import { BACKEND_FETCH_TIMEOUT_MS } from './ingest-dispatch'

export async function updateDocumentTags(
  session: AuthorizedSession,
  documentId: string,
  tags: string[],
  topics?: string[]
): Promise<{ id: string; tags: string[]; topics?: string[] }> {
  const doc = await getAccessibleDocument(session, documentId, 'write')

  const offending = tags.filter((tag) => !ALLOWED_TAGS.has(tag))
  if (offending.length > 0) {
    throw new BadRequestError('Tags outside the controlled vocabulary are not allowed', {
      invalidTags: offending,
    })
  }
  if (topics && (topics.length > MAX_TOPICS || topics.some((t) => t.length < 1 || t.length > MAX_TOPIC_LENGTH))) {
    throw new BadRequestError(`Topics must be at most ${MAX_TOPICS} keywords of 1 to ${MAX_TOPIC_LENGTH} characters`)
  }

  const ref = collectionFileRef(doc)
  if (!ref) throw new NotFoundError()

  let res: Response
  try {
    res = await fetch(collectionFileUrl(getBackendUrl(), ref, '/tags'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(topics === undefined ? { tags } : { tags, topics }),
      signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new UpstreamError('Could not reach the document service')
  }

  if (res.status === 404) throw new NotFoundError()
  if (res.status === 400) {
    throw new BadRequestError('Tags outside the controlled vocabulary are not allowed')
  }
  if (!res.ok) throw new UpstreamError('The document service rejected the tag update')

  const [body] = await Promise.all([
    res.json().catch(() => ({})),
    refreshSearchRows(session.organizationId, [doc]),
  ])
  const answer: { id: string; tags: string[]; topics?: string[] } = {
    id: doc.id,
    tags: Array.isArray(body.tags) ? body.tags : tags,
  }
  if (topics !== undefined) answer.topics = Array.isArray(body.topics) ? body.topics : topics
  return answer
}

export async function renameDocument(
  session: AuthorizedSession,
  documentId: string,
  requestedName: string | null,
  request: Request
): Promise<{ id: string; filename: string; displayName: string | null }> {
  const doc = await getAccessibleDocument(session, documentId, 'write')

  let displayName: string | null = null
  if (requestedName !== null) {
    const validated = validateDocumentName(requestedName)
    if (!validated.ok) {
      throw new BadRequestError('The document name is not usable', { reason: validated.reason })
    }
    displayName = validated.value === doc.filename ? null : validated.value
  }

  await setDocumentDisplayName(documentId, session.organizationId, displayName)
  publishShelfChanged(session.organizationId, documentShelf(doc))

  const mirrorRef = collectionFileRef(doc)
  if (mirrorRef) {
    try {
      await fetch(collectionFileUrl(getBackendUrl(), mirrorRef, '/display-title'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_title: displayName }),
        signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
      })
    } catch {
      // next rename or the next re-ingestion.
    }
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action:
      doc.scope === 'office_shelf' || doc.projectId === null
        ? 'office_shelf.document.renamed'
        : 'document.renamed',
    targetType: 'document',
    targetId: documentId,
    filedIn: filedInOf(doc),
    metadata: {
      filename: doc.filename.slice(0, 200),
      previousName: documentDisplayName(doc).slice(0, 200),
      displayName: (displayName ?? doc.filename).slice(0, 200),
      collectionName: doc.collectionName,
    },
    request,
  })

  return { id: documentId, filename: doc.filename, displayName }
}

export async function eraseProjectDocument(doc: Document, organizationId: string): Promise<boolean | null> {
  const projectId = doc.projectId
  if (projectId === null) throw new NotFoundError()
  const purgeRef = collectionFileRef(doc)
  const chunksPurged = purgeRef
    ? // Permanent: the document is gone, and its Fassung links with it (ADR-0099).
      await purgeIngestedChunks(getBackendUrl(), purgeRef, BACKEND_FETCH_TIMEOUT_MS, { permanent: true })
    : null

  await eraseDocumentObjectsOrKeepRow(doc, organizationId)

  await Promise.all([
    purgeResourceCollaboration('document', doc.id).catch(() => undefined),
    deleteAssignmentsForResource(organizationId, 'document', doc.id).catch(
      () => undefined
    ),
  ])

  await deleteProjectDocument(doc.id, organizationId, projectId)
  publishShelfChanged(organizationId, projectShelf(projectId))

  if (purgeRef) await purgeIngestedChunks(getBackendUrl(), purgeRef, BACKEND_FETCH_TIMEOUT_MS, { permanent: true })

  return chunksPurged
}

export async function deleteDocument(
  session: AuthorizedSession,
  documentId: string,
  request: Request
): Promise<void> {
  const doc = await findDocumentForSession(session, documentId)
  if (doc?.scope === 'office_shelf') {
    const { deleteOfficeShelfDocument } = await import('@/lib/office-shelf/service')
    await deleteOfficeShelfDocument(session, documentId, request)
    return
  }
  if (!doc || doc.scope !== 'project' || doc.projectId === null) throw new NotFoundError()

  await requireFolderWrite(session, doc.projectId, [doc.folderId])
  await assertNoActiveHold(session.organizationId, 'document', documentId)

  const chunksPurged = await eraseProjectDocument(doc, session.organizationId)

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'document.deleted',
    targetType: 'document',
    filedIn: filedInOf(doc),
    metadata: {
      projectId: doc.projectId,
      filename: doc.filename.slice(0, 200),
      collectionName: doc.collectionName,
      chunksPurged,
    },
    request,
  })
}
