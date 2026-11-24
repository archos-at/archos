import type { DocumentAuthor } from '@/lib/db/schema/documents'
import { isNamespacedAgentDocument } from './agent-namespace'

declare const humanAuthored: unique symbol

export interface CollectionFileRef {
  readonly collectionName: string
  readonly filename: string
  readonly documentId: string | null
  readonly [humanAuthored]: true
}

export interface AuthoredDocumentRow {
  id: string | null
  collectionName: string
  filename: string
  authoredBy: DocumentAuthor
  authoredByProducer: string | null
  publishedVersionId: string | null
}

export function collectionFileRef(row: AuthoredDocumentRow): CollectionFileRef | null {
  if (row.authoredBy !== 'user') {
    if (!row.publishedVersionId) return null
    if (!isNamespacedAgentDocument(row)) return null
  }
  return { collectionName: row.collectionName, filename: row.filename, documentId: row.id } as CollectionFileRef
}

export const collectionDocumentsUrl = (backendUrl: string, ref: CollectionFileRef): string =>
  `${backendUrl}/v1/collections/${encodeURIComponent(ref.collectionName)}/documents`

export const collectionFileUrl = (backendUrl: string, ref: CollectionFileRef, suffix: string): string =>
  `${collectionDocumentsUrl(backendUrl, ref)}/${encodeURIComponent(ref.filename)}${suffix}`


export function chunkPurgeBody(refs: readonly CollectionFileRef[], permanent = false): string {
  const byId = refs.every((ref) => ref.documentId)
  return JSON.stringify({
    file_ids: refs.map((ref) => ref.filename),
    ...(byId ? { documents: refs.map((ref) => ({ id: ref.documentId, file_name: ref.filename })) } : {}),
    ...(permanent ? { permanent: true } : {}),
  })
}

async function listsFailedFiles(response: Response): Promise<boolean> {
  const body: unknown = await Promise.resolve()
    .then(() => response.json())
    .catch(() => null)
  if (typeof body !== 'object' || body === null || !('failed' in body)) return false
  return Array.isArray(body.failed) && body.failed.length > 0
}

export async function purgeIngestedChunks(
  backendUrl: string,
  ref: CollectionFileRef,
  timeoutMs: number,
  { permanent = false }: { permanent?: boolean } = {}
): Promise<boolean> {
  try {
    const response = await fetch(collectionDocumentsUrl(backendUrl, ref), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: chunkPurgeBody([ref], permanent),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      console.warn(`[documents] chunk purge refused for ${ref.collectionName}/${ref.filename}: HTTP ${response.status}`)
      return false
    }
    if (await listsFailedFiles(response)) {
      console.warn(`[documents] chunk purge failed inside the backend for ${ref.collectionName}/${ref.filename}`)
      return false
    }
    return true
  } catch (error) {
    console.warn(`[documents] chunk purge failed for ${ref.collectionName}/${ref.filename}`, error)
    return false
  }
}
