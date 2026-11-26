import { createDocumentByIdClient, ByIdResolveError } from '@/lib/documents/by-id-client'
import type { ResolvedDocumentRow } from '@/lib/documents/by-name-client'
import { onDocumentsChanged } from '@/lib/documents/document-changes'

export interface IdentifiedDocument {
  project: ResolvedDocumentRow | null
  officeShelf: ResolvedDocumentRow | null
  error: boolean
}

const SOFT_OFFICE_SHELF_STATUSES = new Set([403, 404])

const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isDocumentId = (value: string | null | undefined): value is string =>
  typeof value === 'string' && DOCUMENT_ID.test(value.trim())

const NOT_ASKED: IdentifiedDocument = { project: null, officeShelf: null, error: false }

const cache = new Map<string, Promise<IdentifiedDocument>>()
const pending = new Map<string, Map<string, Array<(result: IdentifiedDocument) => void>>>()

let client = createDocumentByIdClient()

export const resetDocumentsByIdCache = (): void => {
  cache.clear()
  pending.clear()
}

export const setDocumentsByIdFetch = (run?: Parameters<typeof createDocumentByIdClient>[0]): void => {
  client = createDocumentByIdClient(run)
}

onDocumentsChanged(resetDocumentsByIdCache)

const projectScope = (projectId: string | null): string => projectId ?? '__no-project__'

async function settled(
  request: Promise<ResolvedDocumentRow[]>,
  soft: ReadonlySet<number>
): Promise<{ rows: ResolvedDocumentRow[]; failed: boolean }> {
  try {
    return { rows: await request, failed: false }
  } catch (error) {
    const status = error instanceof ByIdResolveError ? error.status : 0
    return { rows: [], failed: !soft.has(status) }
  }
}

async function flush(projectId: string | null): Promise<void> {
  const scope = projectScope(projectId)
  const batch = pending.get(scope)
  pending.delete(scope)
  if (!batch) return
  const ids = [...batch.keys()]
  const [project, officeShelf] = await Promise.all([
    projectId ? settled(client.project(projectId, ids), new Set()) : Promise.resolve({ rows: [], failed: false }),
    settled(client.officeShelf(ids), SOFT_OFFICE_SHELF_STATUSES),
  ])
  const projectById = new Map(project.rows.map((row) => [row.id, row]))
  const officeShelfById = new Map(officeShelf.rows.map((row) => [row.id, row]))
  const error = project.failed || officeShelf.failed
  for (const [id, resolvers] of batch) {
    const result = { project: projectById.get(id) ?? null, officeShelf: officeShelfById.get(id) ?? null, error }
    for (const resolve of resolvers) resolve(result)
  }
}

function requestId(projectId: string | null, id: string): Promise<IdentifiedDocument> {
  const scope = projectScope(projectId)
  let batch = pending.get(scope)
  if (!batch) {
    batch = new Map()
    pending.set(scope, batch)
    queueMicrotask(() => void flush(projectId))
  }
  const waiting = batch
  return new Promise((resolve) => {
    waiting.set(id, [...(waiting.get(id) ?? []), resolve])
  })
}

export async function resolveDocumentsById(
  projectId: string | null,
  ids: readonly string[]
): Promise<Map<string, IdentifiedDocument>> {
  const entries = await Promise.all(
    [...new Set(ids.map((id) => id.trim()).filter(Boolean))].map(async (id) => {
      if (!isDocumentId(id)) return [id, NOT_ASKED] as const
      const cacheKey = `${projectScope(projectId)}|${id}`
      let promise = cache.get(cacheKey)
      if (!promise) {
        promise = requestId(projectId, id)
        cache.set(cacheKey, promise)
        void promise.then((result) => {
          if (result.error && cache.get(cacheKey) === promise) cache.delete(cacheKey)
        })
      }
      return [id, await promise] as const
    })
  )
  return new Map(entries)
}
