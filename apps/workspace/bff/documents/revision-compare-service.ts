import 'server-only'
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  UnprocessableError,
  UpstreamError,
} from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { restrictedCollectionBase } from '@/lib/authz/folder-access-rule'
import { getBackendUrl } from '@/lib/backend-proxy'
import type { Document } from '@/lib/db/schema/documents'
import { internalServiceHeaders } from '@/lib/internal-auth'
import { getAccessibleDocument } from './access'
import { collectionFileRef } from './collection-file-ref'
import { hasPassedScreening } from './document-reader'
import { parseRevisionVisualChanges, type RevisionVisualChanges } from './revision-compare-types'
import { PRODUCT_NAME } from '@/lib/brand'

const BACKEND_TIMEOUT_MS = 120_000

const compareUrl = (backendUrl: string, collectionName: string): string =>
  `${backendUrl}/v1/collections/${encodeURIComponent(collectionName)}/revision-compare`

const pagesUrl = (backendUrl: string, collectionName: string): string =>
  `${backendUrl}/v1/collections/${encodeURIComponent(collectionName)}/revision-pages`

async function loadForComparing(session: AuthorizedSession, documentId: string): Promise<Document> {
  const doc = await getAccessibleDocument(session, documentId, 'read')
  if (!hasPassedScreening(doc)) throw new NotFoundError()
  if (doc.scope === 'session') throw new BadRequestError('A chat attachment has no Fassungen', { reason: 'session_document' })
  if (doc.lifecycle !== 'active') throw new BadRequestError('An archived document has no Fassungen', { reason: 'archived' })
  return doc
}

async function postToBackend(session: AuthorizedSession, url: string, body: object): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...internalServiceHeaders(getBackendUrl()),
        'x-organization-id': session.organizationId,
        'x-user-id': session.userId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    })
  } catch {
    throw new UpstreamError('Could not reach the document service')
  }
}

function refusalFor(status: number): Error {
  switch (status) {
    case 404:
      return new NotFoundError('That page is not available for comparison')
    case 409:
      return new ConflictError('A document has not been read yet', { reason: 'not_ingested' })
    case 400:
    case 422:
      return new BadRequestError('The document service refused this comparison')
    case 503:
      return new ServiceUnavailableError('No vision model is configured')
    default:
      return new UpstreamError('The comparison could not be made')
  }
}

export type ComparePurpose = 'person' | 'notice'

async function loadPair(session: AuthorizedSession, newerId: string, olderId: string): Promise<[Document, Document]> {
  if (newerId === olderId) throw new BadRequestError('A document is not its own earlier Fassung', { reason: 'same_document' })

  const newer = await loadForComparing(session, newerId)
  const older = await loadForComparing(session, olderId)
  if (newer.collectionName !== older.collectionName) {
    throw new BadRequestError('Both documents must be in the same collection', { reason: 'different_collection' })
  }
  if (!collectionFileRef(newer) || !collectionFileRef(older)) throw new NotFoundError()
  if (restrictedCollectionBase(newer.collectionName.toLowerCase()) !== null) {
    throw new UnprocessableError('Documents in a restricted folder cannot be compared by ' + PRODUCT_NAME, {
      reason: 'restricted_folder',
    })
  }
  return [newer, older]
}

export interface RevisionPageComparison {
  changes: RevisionVisualChanges
  traceId: string | null
}

const traceIdOf = (raw: unknown): string | null => {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).trace_id : null
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) ? value : null
}

export async function compareRevisionPage(
  session: AuthorizedSession,
  newerId: string,
  olderId: string,
  page: number,
  purpose: ComparePurpose = 'person',
): Promise<RevisionPageComparison> {
  const { changes, traceId } = await comparePair(session, newerId, olderId, page, purpose)
  return { changes, traceId }
}

async function comparePair(
  session: AuthorizedSession,
  newerId: string,
  olderId: string,
  page: number,
  purpose: ComparePurpose,
): Promise<RevisionPageComparison & { olderName: string; newerName: string }> {
  const [newer, older] = await loadPair(session, newerId, olderId)
  const response = await postToBackend(session, compareUrl(getBackendUrl(), newer.collectionName), {
    older: older.filename,
    newer: newer.filename,
    page,
    purpose,
  })
  if (!response.ok) {
    console.warn('[Fassung compare] backend refused:', response.status)
    throw refusalFor(response.status)
  }
  const raw: unknown = await response.json().catch(() => null)
  return { changes: parseRevisionVisualChanges(raw), traceId: traceIdOf(raw), olderName: older.filename, newerName: newer.filename }
}

export async function compareRevisionVisually(
  session: AuthorizedSession,
  newerId: string,
  olderId: string,
  page: number,
): Promise<RevisionVisualChanges & { older_name: string; newer_name: string }> {
  const { changes, olderName, newerName } = await comparePair(session, newerId, olderId, page, 'person')
  return { ...changes, older_name: olderName, newer_name: newerName }
}

export interface ChangedRevisionPages {
  pages: number[]
  newerPageCount: number
  comparable: boolean
}

const pageList = (raw: unknown): number[] =>
  Array.isArray(raw) ? raw.filter((page): page is number => Number.isInteger(page) && page >= 1 && page <= 2000) : []

export async function changedRevisionPages(
  session: AuthorizedSession,
  newerId: string,
  olderId: string,
): Promise<ChangedRevisionPages> {
  const [newer, older] = await loadPair(session, newerId, olderId)
  const response = await postToBackend(session, pagesUrl(getBackendUrl(), newer.collectionName), {
    older: older.filename,
    newer: newer.filename,
  })
  if (!response.ok) {
    console.warn('[Fassung compare] backend refused the changed pages:', response.status)
    throw refusalFor(response.status)
  }
  const body: unknown = await response.json().catch(() => null)
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const count = record.newer_page_count
  return {
    pages: pageList(record.pages),
    newerPageCount: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0,
    comparable: record.comparable === true,
  }
}
