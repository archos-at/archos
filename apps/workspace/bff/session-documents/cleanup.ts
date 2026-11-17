import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import type { Document } from '@/lib/db/schema/documents'
import {
  collectionFileRef,
  type CollectionFileRef,
} from '@/lib/documents/collection-file-ref'
import {
  deleteDocumentObjects,
  describeCleanupError as describeError,
  type ExternalCleanupResult,
} from '@/lib/documents/object-cleanup'
import {
  deleteSessionDocumentsByIds,
  listSessionDocumentsForCleanup,
  SESSION_DOCUMENT_LIST_LIMIT,
} from './repository'

const BACKEND_FETCH_TIMEOUT_MS = 10_000

export async function purgeCollectionChunks(
  collectionName: string,
  refs: CollectionFileRef[],
): Promise<ExternalCleanupResult> {
  if (refs.length === 0) return { ok: true }
  try {
    const response = await fetch(
      `${getBackendUrl()}/v1/collections/${encodeURIComponent(collectionName)}/documents`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: refs.map((ref) => ref.filename) }),
        signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
      },
    )
    if (!response.ok) {
      return { ok: false, reason: `chunk purge of ${collectionName} answered ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: `chunk purge of ${collectionName}: ${describeError(error)}` }
  }
}

export async function purgeChunksAgain(docs: readonly Document[]): Promise<void> {
  const byCollection = new Map<string, CollectionFileRef[]>()
  for (const doc of docs) {
    const ref = collectionFileRef(doc)
    if (!ref) continue
    byCollection.set(doc.collectionName, [...(byCollection.get(doc.collectionName) ?? []), ref])
  }
  for (const [collectionName, refs] of byCollection) {
    const again = await purgeCollectionChunks(collectionName, refs)
    if (!again.ok) {
      console.warn('[session-documents] second chunk purge after the row delete failed:', again.reason)
    }
  }
}

export async function deleteSessionCollection(collectionName: string): Promise<ExternalCleanupResult> {
  const url = `${getBackendUrl()}/v1/collections/${encodeURIComponent(collectionName)}`
  try {
    const probe = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS) })
    if (probe.status === 404 || probe.status === 503) return { ok: true }
    if (!probe.ok) {
      return { ok: false, reason: `collection probe of ${collectionName} answered ${probe.status}` }
    }
    const response = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS) })
    if (response.ok || response.status === 404) return { ok: true }
    return { ok: false, reason: `collection delete of ${collectionName} answered ${response.status}` }
  } catch (error) {
    return { ok: false, reason: `collection delete of ${collectionName}: ${describeError(error)}` }
  }
}

export interface SessionDocumentPurgeResult {
  ok: boolean
  purged: number
  retained: number
  failures: string[]
}

export async function purgeSessionDocuments(
  conversationId: string,
  organizationId: string,
): Promise<SessionDocumentPurgeResult> {
  const result: SessionDocumentPurgeResult = { ok: true, purged: 0, retained: 0, failures: [] }

  const attempted = new Set<string>()

  for (;;) {
    const page = await listSessionDocumentsForCleanup(conversationId, organizationId)
    const docs = page.filter((doc) => !attempted.has(doc.id))
    if (docs.length === 0) break
    for (const doc of docs) attempted.add(doc.id)

    const byCollection = new Map<string, CollectionFileRef[]>()
    for (const doc of docs) {
      const ref = collectionFileRef(doc)
      if (!ref) continue
      byCollection.set(doc.collectionName, [...(byCollection.get(doc.collectionName) ?? []), ref])
    }
    const failedCollections = new Map<string, string>()
    for (const [collectionName, filenames] of byCollection) {
      const chunks = await purgeCollectionChunks(collectionName, filenames)
      if (!chunks.ok) failedCollections.set(collectionName, chunks.reason ?? 'chunk purge failed')
    }

    const erasedIds: string[] = []
    for (const doc of docs) {
      const objects = await deleteDocumentObjects(doc)
      const chunkFailure = failedCollections.get(doc.collectionName)

      if (objects.ok && !chunkFailure) {
        erasedIds.push(doc.id)
        continue
      }
      result.retained += 1
      result.failures.push(`${doc.id}: ${objects.ok ? chunkFailure : objects.reason}`)
    }

    await deleteSessionDocumentsByIds(erasedIds, organizationId, conversationId)
    result.purged += erasedIds.length

    await purgeChunksAgain(docs.filter((doc) => erasedIds.includes(doc.id)))

    if (page.length < SESSION_DOCUMENT_LIST_LIMIT) break
  }

  result.ok = result.retained === 0
  return result
}
