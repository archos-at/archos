import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { documents } from '@/lib/db/schema/documents'
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
}

function safeDecode(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

async function liveFilenamesByCollection(): Promise<Map<string, Set<string>>> {
  const db = getDb()
  const rows = (await withPlatformAccess(
    'vector reconciliation sweep: every collection in the deployment, across organizations',
    () =>
      db
        .select({
          collectionName: documents.collectionName,
          filename: documents.filename,
          authoredBy: documents.authoredBy,
        })
        .from(documents),
  )) as { collectionName: string; filename: string; authoredBy: string }[]

  const byCollection = new Map<string, Set<string>>()
  for (const row of rows) {
    let names = byCollection.get(row.collectionName)
    if (!names) {
      names = new Set<string>()
      byCollection.set(row.collectionName, names)
    }
    if (row.authoredBy === 'user') names.add(row.filename)
  }
  return byCollection
}

async function liveFilenamesIn(collectionName: string): Promise<Set<string>> {
  const db = getDb()
  const rows = (await withPlatformAccess(
    'vector reconciliation sweep: re-reading one collection before deleting its orphans',
    () =>
      db
        .select({ filename: documents.filename, authoredBy: documents.authoredBy })
        .from(documents)
        .where(eq(documents.collectionName, collectionName)),
  )) as { filename: string; authoredBy: string }[]
  return new Set(rows.filter((row) => row.authoredBy === 'user').map((row) => row.filename))
}

async function listStoredFilenames(collectionName: string): Promise<string[]> {
  const res = await fetch(
    `${getBackendUrl()}/v1/collections/${encodeURIComponent(collectionName)}/documents`,
    { signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS) },
  )
  if (!res.ok) throw new Error(`list returned ${res.status}`)
  const body = (await res.json()) as BackendFileInfo[]
  if (!Array.isArray(body)) return []
  return body.map((file) => file.file_name).filter((name): name is string => typeof name === 'string' && name.length > 0)
}

async function deleteChunks(collectionName: string, fileIds: string[]): Promise<number> {
  const res = await fetch(
    `${getBackendUrl()}/v1/collections/${encodeURIComponent(collectionName)}/documents`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: fileIds }),
      signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
    },
  )
  if (!res.ok) throw new Error(`delete returned ${res.status}`)
  const body = (await res.json().catch(() => ({}))) as { total_deleted?: number }
  return typeof body.total_deleted === 'number' ? body.total_deleted : 0
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
  const live = await liveFilenamesByCollection()
  const result: VectorReconcileResult = {
    collectionsScanned: 0,
    orphansFound: 0,
    orphansDeleted: 0,
    summariesForgotten: 0,
    failures: [],
  }

  for (const [collectionName, liveNames] of live) {
    result.collectionsScanned += 1
    try {
      const stored = await listStoredFilenames(collectionName)
      const candidates = stored.filter((name) => !liveNames.has(safeDecode(name)))
      if (candidates.length === 0) continue
      const liveNow = await liveFilenamesIn(collectionName)
      const orphans = candidates.filter((name) => !liveNow.has(safeDecode(name)))
      if (orphans.length === 0) continue
      result.orphansFound += orphans.length
      result.orphansDeleted += await deleteChunks(collectionName, orphans)
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
