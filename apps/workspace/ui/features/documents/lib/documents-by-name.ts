import { createDocumentByNameClient, ByNameResolveError, type ResolvedDocumentRow } from '@/lib/documents/by-name-client'
import { onDocumentsChanged } from '@/lib/documents/document-changes'

export interface NamedDocuments {
  project: ResolvedDocumentRow[]
  officeShelf: ResolvedDocumentRow[]
  error: boolean
}

export const documentNameLookupKey = (name: string): string => name.normalize('NFC').trim().toLowerCase()

const SOFT_OFFICE_SHELF_STATUSES = new Set([403, 404])

const cache = new Map<string, Promise<NamedDocuments>>()

interface PendingBatch {
  names: Map<string, string>
  settle: Map<string, Array<(result: NamedDocuments) => void>>
}
const pending = new Map<string, PendingBatch>()

let client = createDocumentByNameClient()

export const resetDocumentsByNameCache = (): void => {
  cache.clear()
  pending.clear()
}

export const setDocumentsByNameFetch = (run?: Parameters<typeof createDocumentByNameClient>[0]): void => {
  client = createDocumentByNameClient(run)
}

onDocumentsChanged(resetDocumentsByNameCache)

const projectScope = (projectId: string | null): string => projectId ?? '__no-project__'

async function settled(
  request: Promise<ResolvedDocumentRow[]>,
  soft: ReadonlySet<number>
): Promise<{ rows: ResolvedDocumentRow[]; failed: boolean }> {
  try {
    return { rows: await request, failed: false }
  } catch (error) {
    const status = error instanceof ByNameResolveError ? error.status : 0
    return { rows: [], failed: !soft.has(status) }
  }
}

function groupByKey(rows: ResolvedDocumentRow[]): Map<string, ResolvedDocumentRow[]> {
  const grouped = new Map<string, ResolvedDocumentRow[]>()
  for (const row of rows) {
    const key = documentNameLookupKey(row.filename)
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return grouped
}

async function flush(projectId: string | null): Promise<void> {
  const scope = projectScope(projectId)
  const batch = pending.get(scope)
  pending.delete(scope)
  if (!batch) return
  const names = [...batch.names.values()]
  const [project, officeShelf] = await Promise.all([
    projectId
      ? settled(client.project(projectId, names), new Set())
      : Promise.resolve({ rows: [], failed: false }),
    settled(client.officeShelf(names), SOFT_OFFICE_SHELF_STATUSES),
  ])
  const projektByKey = groupByKey(project.rows)
  const officeShelfByKey = groupByKey(officeShelf.rows)
  const error = project.failed || officeShelf.failed
  for (const [key, resolvers] of batch.settle) {
    const result: NamedDocuments = {
      project: projektByKey.get(key) ?? [],
      officeShelf: officeShelfByKey.get(key) ?? [],
      error,
    }
    for (const resolve of resolvers) resolve(result)
  }
}

function requestName(projectId: string | null, name: string, key: string): Promise<NamedDocuments> {
  const scope = projectScope(projectId)
  let batch = pending.get(scope)
  if (!batch) {
    batch = { names: new Map(), settle: new Map() }
    pending.set(scope, batch)
    queueMicrotask(() => void flush(projectId))
  }
  batch.names.set(key, name)
  return new Promise((resolve) => {
    batch.settle.set(key, [...(batch.settle.get(key) ?? []), resolve])
  })
}

export async function resolveDocumentsByName(
  projectId: string | null,
  names: readonly string[]
): Promise<Map<string, NamedDocuments>> {
  const entries = await Promise.all(
    [...new Set(names.map((name) => name.trim()).filter(Boolean))].map(async (name) => {
      const key = documentNameLookupKey(name)
      const cacheKey = `${projectScope(projectId)}|${key}`
      let promise = cache.get(cacheKey)
      if (!promise) {
        promise = requestName(projectId, name, key)
        cache.set(cacheKey, promise)
        void promise.then((result) => {
          if (result.error && cache.get(cacheKey) === promise) cache.delete(cacheKey)
        })
      }
      return [key, await promise] as const
    })
  )
  return new Map(entries)
}
