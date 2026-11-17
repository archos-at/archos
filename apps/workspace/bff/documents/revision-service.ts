import 'server-only'
import { BadRequestError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBackendUrl } from '@/lib/backend-proxy'
import type { Document } from '@/lib/db/schema/documents'
import { internalServiceHeaders } from '@/lib/internal-auth'
import { refreshSearchRows } from '@/lib/search/refresh-rows'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { getAccessibleDocument } from './access'
import { collectionFileRef } from './collection-file-ref'
import { hasPassedScreening } from './document-reader'
import { changeSummaryAgainst, type RevisionLinks } from './revision-links'
import { loadRevisionLinks } from './revision-links-loader'
import { announceNewRevision } from './revision-notify'

const BACKEND_TIMEOUT_MS = 10_000

export interface RevisionLinkResult {
  id: string
  revision: RevisionLinks | null
  older: { id: string; revision: RevisionLinks | null }
}

const revisionUrl = (backendUrl: string, collectionName: string): string =>
  `${backendUrl}/v1/collections/${encodeURIComponent(collectionName)}/revision`

async function loadForLinking(session: AuthorizedSession, documentId: string): Promise<Document> {
  const doc = await getAccessibleDocument(session, documentId, 'write')
  if (!hasPassedScreening(doc)) throw new NotFoundError()
  if (doc.scope === 'session') throw new BadRequestError('A chat attachment has no Fassungen', { reason: 'session_document' })
  if (doc.lifecycle !== 'active') throw new BadRequestError('An archived document has no Fassungen', { reason: 'archived' })
  return doc
}

async function putLink(session: AuthorizedSession, newer: Document, older: Document, linked: boolean): Promise<void> {
  if (!collectionFileRef(newer) || !collectionFileRef(older)) throw new NotFoundError()

  let res: Response
  try {
    res = await fetch(revisionUrl(getBackendUrl(), newer.collectionName), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...internalServiceHeaders(getBackendUrl()),
        'x-organization-id': session.organizationId,
        'x-user-id': session.userId,
      },
      body: JSON.stringify({ newer: newer.filename, older: older.filename, linked }),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    })
  } catch {
    throw new UpstreamError('Could not reach the document service')
  }
  if (res.status === 404) throw new NotFoundError()
  if (res.status === 400 || res.status === 409 || res.status === 422) {
    throw new BadRequestError('The document service refused this Fassung link')
  }
  if (!res.ok) throw new UpstreamError('The document service rejected the Fassung update')
}

export async function setRevisionLink(
  session: AuthorizedSession,
  newerId: string,
  olderId: string,
  linked: boolean,
  request: Request,
): Promise<RevisionLinkResult> {
  if (newerId === olderId) throw new BadRequestError('A document is not its own earlier Fassung', { reason: 'same_document' })

  const newer = await loadForLinking(session, newerId)
  const older = await loadForLinking(session, olderId)
  if (newer.collectionName !== older.collectionName) {
    throw new BadRequestError('Both documents must be in the same collection', { reason: 'different_collection' })
  }

  await putLink(session, newer, older, linked)

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'document.revision_changed',
    targetType: 'document',
    targetId: newer.id,
    metadata: { olderDocumentId: older.id, linked, collectionName: newer.collectionName },
    request,
  })

  const reader = await shelfReaderFor(session, newer)
  const [facts] = await Promise.all([
    loadRevisionLinks(session, [newer, older], reader, { fresh: true }),
    refreshSearchRows(session.organizationId, [newer, older]),
  ])
  const newerRevision = facts.get(newer.id) ?? null

  if (linked) {
    void announceNewRevision({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      newerId: newer.id,
      olderId: older.id,
      changeSummary: changeSummaryAgainst(newerRevision?.changeSummary ?? null, older.id),
    })
  }

  return {
    id: newer.id,
    revision: newerRevision,
    older: { id: older.id, revision: facts.get(older.id) ?? null },
  }
}
