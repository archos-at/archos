import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { documents, type DocumentAuthor } from '@/lib/db/schema/documents'
import { collectionFileRef } from '@/lib/documents/collection-file-ref'
import { getBackendUrl } from '@/lib/backend-proxy'
import { internalServiceHeaders } from '@/lib/internal-auth'
import { syncAllProjectFacts, type ProjectFactsSyncResult } from '@/lib/cross-project/project-facts-mirror'

const BACKEND_FETCH_TIMEOUT_MS = 15_000

export interface VectorReconcileResult {
  collectionsScanned: number
  orphansFound: number
  orphansDeleted: number
  summariesForgotten: number
  failures: { collectionName: string; error: string }[]
  projectFacts?: ProjectFactsSyncResult
  documentFacts?: DocumentFactsRefreshResult
}

export interface DocumentFactsRefreshResult {
  collections: number
  files: number
  unsupported: boolean
}

export const SUMMARY_SWEEP_FAILURE_NAME = '*'
export const PROJECT_FACTS_FAILURE_NAME = '*project-facts'

export const DOCUMENT_FACTS_BATCH = 25
const DOCUMENT_FACTS_TIMEOUT_MS = 120_000

interface BackendSummaryReconcile {
  orphans_forgotten?: number
  forgotten?: { collection: string; file_name: string }[]
  failures?: { collection: string; error: string }[]
}

interface BackendFileInfo {
  file_name?: string
  document_id?: string | null
}

interface StoredFile {
  fileName: string
  documentId: string | null
}

interface LiveDocuments {
  ids: Set<string>
  names: Set<string>
}

function safeDecode(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

type LiveRow = {
  id: string
  collectionName: string
  filename: string
  authoredBy: DocumentAuthor
  authoredByProducer: string | null
  publishedVersionId: string | null
}

const liveRowColumns = {
  id: documents.id,
  collectionName: documents.collectionName,
  filename: documents.filename,
  authoredBy: documents.authoredBy,
  authoredByProducer: documents.authoredByProducer,
  publishedVersionId: documents.publishedVersionId,
}

function addLive(live: LiveDocuments, row: LiveRow): void {
  if (!collectionFileRef(row)) return
  live.ids.add(row.id)
  live.names.add(row.filename)
}

async function liveDocumentsByCollection(): Promise<Map<string, LiveDocuments>> {
  const db = getDb()
  const rows = (await withPlatformAccess(
    'vector reconciliation sweep: every collection in the deployment, across organizations',
    () => db.select(liveRowColumns).from(documents),
  )) as LiveRow[]

  const byCollection = new Map<string, LiveDocuments>()
  for (const row of rows) {
    let live = byCollection.get(row.collectionName)
    if (!live) {
      live = { ids: new Set<string>(), names: new Set<string>() }
      byCollection.set(row.collectionName, live)
    }
    addLive(live, row)
  }
  return byCollection
}

async function liveDocumentsIn(collectionName: string): Promise<LiveDocuments> {
  const db = getDb()
  const rows = (await withPlatformAccess(
    'vector reconciliation sweep: re-reading one collection before deleting its orphans',
    () => db.select(liveRowColumns).from(documents).where(eq(documents.collectionName, collectionName)),
  )) as LiveRow[]
  const live: LiveDocuments = { ids: new Set<string>(), names: new Set<string>() }
  for (const row of rows) addLive(live, row)
  return live
}

const isOrphanOf = (live: LiveDocuments) => (file: StoredFile): boolean =>
  file.documentId ? !live.ids.has(file.documentId) : !live.names.has(safeDecode(file.fileName))

async function listStoredFiles(collectionName: string): Promise<StoredFile[]> {
  const res = await fetch(
    `${getBackendUrl()}/v1/collections/${encodeURIComponent(collectionName)}/documents`,
    { signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS) },
  )
  if (!res.ok) throw new Error(`list returned ${res.status}`)
  const body = (await res.json()) as BackendFileInfo[]
  if (!Array.isArray(body)) return []
  return body.flatMap((file) =>
    typeof file.file_name === 'string' && file.file_name.length > 0
      ? [{ fileName: file.file_name, documentId: typeof file.document_id === 'string' && file.document_id.length > 0 ? file.document_id : null }]
      : [],
  )
}

async function deleteChunks(collectionName: string, body: object): Promise<number> {
  const res = await fetch(
    `${getBackendUrl()}/v1/collections/${encodeURIComponent(collectionName)}/documents`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
    },
  )
  if (!res.ok) throw new Error(`delete returned ${res.status}`)
  const answer = (await res.json().catch(() => ({}))) as { total_deleted?: number }
  return typeof answer.total_deleted === 'number' ? answer.total_deleted : 0
}

async function deleteOrphans(collectionName: string, orphans: readonly StoredFile[]): Promise<number> {
  const identified = orphans.filter((file) => file.documentId !== null)
  const named = orphans.filter((file) => file.documentId === null)
  let deleted = 0
  if (identified.length > 0) {
    deleted += await deleteChunks(collectionName, {
      file_ids: identified.map((file) => file.fileName),
      documents: identified.map((file) => ({ id: file.documentId, file_name: file.fileName })),
    })
  }
  if (named.length > 0) deleted += await deleteChunks(collectionName, { file_ids: named.map((file) => file.fileName) })
  return deleted
}

async function reconcileOrphanedSummaries(
  collectionNames: string[],
): Promise<Pick<VectorReconcileResult, 'summariesForgotten' | 'failures'>> {
  if (collectionNames.length === 0) return { summariesForgotten: 0, failures: [] }
  const res = await fetch(`${getBackendUrl()}/v1/maintenance/reconcile-summaries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...internalServiceHeaders(getBackendUrl()),
    },
    body: JSON.stringify({ collections: collectionNames, dry_run: false }),
    signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`reconcile-summaries returned ${res.status}`)
  const body = (await res.json().catch(() => ({}))) as BackendSummaryReconcile
  return {
    summariesForgotten: typeof body.orphans_forgotten === 'number' ? body.orphans_forgotten : 0,
    failures: (body.failures ?? []).map((failure) => ({
      collectionName: failure.collection,
      error: `summary reconcile: ${failure.error}`,
    })),
  }
}

interface BackendDocumentFactsRefresh {
  collections_scanned?: number
  files_refreshed?: number
  failures?: { collection: string; error: string }[]
}

async function refreshDocumentFacts(
  collectionNames: string[],
): Promise<{ result: DocumentFactsRefreshResult; failures: VectorReconcileResult['failures'] }> {
  const result: DocumentFactsRefreshResult = { collections: 0, files: 0, unsupported: false }
  const failures: VectorReconcileResult['failures'] = []
  for (let start = 0; start < collectionNames.length; start += DOCUMENT_FACTS_BATCH) {
    const batch = collectionNames.slice(start, start + DOCUMENT_FACTS_BATCH)
    try {
      const res = await fetch(`${getBackendUrl()}/v1/maintenance/refresh-document-facts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...internalServiceHeaders(getBackendUrl()),
        },
        body: JSON.stringify({ collections: batch }),
        signal: AbortSignal.timeout(DOCUMENT_FACTS_TIMEOUT_MS),
      })
      if (res.status === 409) return { result: { ...result, unsupported: true }, failures }
      if (!res.ok) throw new Error(`refresh-document-facts returned ${res.status}`)
      const body = (await res.json().catch(() => ({}))) as BackendDocumentFactsRefresh
      result.collections += typeof body.collections_scanned === 'number' ? body.collections_scanned : 0
      result.files += typeof body.files_refreshed === 'number' ? body.files_refreshed : 0
      failures.push(
        ...(body.failures ?? []).map((failure) => ({
          collectionName: failure.collection,
          error: `document facts: ${failure.error}`,
        })),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      failures.push(...batch.map((collectionName) => ({ collectionName, error: `document facts: ${message}` })))
    }
  }
  return { result, failures }
}

export async function reconcileOrphanedVectors(): Promise<VectorReconcileResult> {
  const live = await liveDocumentsByCollection()
  const result: VectorReconcileResult = {
    collectionsScanned: 0,
    orphansFound: 0,
    orphansDeleted: 0,
    summariesForgotten: 0,
    failures: [],
  }

  for (const [collectionName, liveThen] of live) {
    result.collectionsScanned += 1
    try {
      const stored = await listStoredFiles(collectionName)
      const candidates = stored.filter(isOrphanOf(liveThen))
      if (candidates.length === 0) continue
      const orphans = candidates.filter(isOrphanOf(await liveDocumentsIn(collectionName)))
      if (orphans.length === 0) continue
      result.orphansFound += orphans.length
      result.orphansDeleted += await deleteOrphans(collectionName, orphans)
    } catch (error) {
      result.failures.push({
        collectionName,
        error: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

  try {
    const summaries = await reconcileOrphanedSummaries([...live.keys()])
    result.summariesForgotten = summaries.summariesForgotten
    result.failures.push(...summaries.failures)
  } catch (error) {
    result.failures.push({
      collectionName: SUMMARY_SWEEP_FAILURE_NAME,
      error: `summary reconcile: ${error instanceof Error ? error.message : 'unknown error'}`,
    })
  }

  try {
    result.projectFacts = await syncAllProjectFacts()
  } catch (error) {
    result.failures.push({
      collectionName: PROJECT_FACTS_FAILURE_NAME,
      error: `project facts: ${error instanceof Error ? error.message : 'unknown error'}`,
    })
  }

  const documentFacts = await refreshDocumentFacts([...live.keys()])
  result.documentFacts = documentFacts.result
  result.failures.push(...documentFacts.failures)

  return result
}
