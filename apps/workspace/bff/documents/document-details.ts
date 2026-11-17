import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { internalServiceHeaders } from '@/lib/internal-auth'
import { NotFoundError } from '@/lib/api/errors'
import { normalizeDrawingStructured, type DrawingStructured } from './drawing-structured'
import type { AuthorizedSession } from '@/lib/auth/types'
import { reconcileDocumentStatuses } from './reconcile-status'
import { loadRevisionLinks } from './revision-links-loader'
import { collectionFileRef, collectionFileUrl } from './collection-file-ref'
import { documentExistsInCollection } from './repository'
import { getAccessibleDocument } from './access'
import { hasPassedScreening } from './document-reader'
import { maySeeHeld, shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { quarantineVerdictOf } from '@/lib/upload-screening/quarantine'
import { findOpenVersion, listDocumentVersionSummaries } from './version-repository'
import { BACKEND_FETCH_TIMEOUT_MS } from './ingest-dispatch'

export interface DocumentVisualDetail {
  page: number
  contentType: string
  drawingType: string
  scale: string
  text: string
  segment: number
  segmentCount: number
  structured: DrawingStructured | null
}

export async function getDocumentVisualDetails(
  session: AuthorizedSession,
  documentId: string
): Promise<{ id: string; details: DocumentVisualDetail[] }> {
  const doc = await getAccessibleDocument(session, documentId, 'read')

  const ref = collectionFileRef(doc)
  if (!ref) return { id: doc.id, details: [] }

  let res: Response
  try {
    res = await fetch(collectionFileUrl(getBackendUrl(), ref, '/visual-details'), {
      headers: { ...internalServiceHeaders(getBackendUrl()), 'x-organization-id': session.organizationId },
      signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
    })
  } catch {
    return { id: doc.id, details: [] }
  }

  if (!res.ok) return { id: doc.id, details: [] }

  const body = await res.json().catch(() => ({}))
  const raw = Array.isArray(body.details) ? body.details : []
  const details: DocumentVisualDetail[] = raw.map((d: Record<string, unknown>) => ({
    page: typeof d.page === 'number' ? d.page : 0,
    contentType: typeof d.content_type === 'string' ? d.content_type : 'drawing',
    drawingType: typeof d.drawing_type === 'string' ? d.drawing_type : '',
    scale: typeof d.scale === 'string' ? d.scale : '',
    text: typeof d.text === 'string' ? d.text : '',
    segment: typeof d.segment === 'number' ? d.segment : 0,
    segmentCount: typeof d.segment_count === 'number' ? d.segment_count : 1,
    structured: normalizeDrawingStructured(d.structured),
  }))
  return { id: doc.id, details }
}

export async function getDocumentStatus(session: AuthorizedSession, documentId: string) {
  const doc = await getAccessibleDocument(session, documentId)

  const [reconciled] = await reconcileDocumentStatuses([doc], session.organizationId, 'read')
  if (!hasPassedScreening(reconciled) && !(await maySeeHeld(session, reconciled))) throw new NotFoundError()
  const [openVersion, [versionSummary]] = await Promise.all([
    findOpenVersion(reconciled.id, session.organizationId),
    listDocumentVersionSummaries([reconciled.id], session.organizationId),
  ])
  const revision =
    (await loadRevisionLinks(session, [reconciled], await shelfReaderFor(session, reconciled))).get(reconciled.id) ?? null

  return {
    id: reconciled.id,
    status: reconciled.status,
    filename: reconciled.filename,
    displayName: reconciled.displayName,
    scope: reconciled.scope,
    fileSize: reconciled.fileSize,
    contentType: reconciled.contentType,
    collectionName: reconciled.collectionName,
    errorMessage: reconciled.errorMessage,
    quarantine: quarantineVerdictOf(reconciled),
    createdAt: reconciled.createdAt,
    updatedAt: reconciled.updatedAt,
    summary: reconciled.summary,
    pageCount: reconciled.pageCount,
    chunkCount: reconciled.chunkCount,
    contentTypes: reconciled.contentTypes,
    tags: reconciled.tags,
    topics: reconciled.topics,
    capture: reconciled.capture,
    revisionFacts: reconciled.revisionFacts,
    dossier: reconciled.dossier,
    docReferences: reconciled.docReferences,
    coverage: reconciled.coverage,
    revision,
    queueAhead: reconciled.queueAhead ?? null,
    authoredBy: reconciled.authoredBy,
    openVersion: openVersion ? { id: openVersion.id, state: openVersion.state } : null,
    versionCount: versionSummary?.versionCount ?? null,
  }
}

export async function documentStillExists(
  documentId: string,
  collectionName: string,
  organizationId?: string
): Promise<boolean> {
  return documentExistsInCollection(documentId, collectionName, organizationId)
}
