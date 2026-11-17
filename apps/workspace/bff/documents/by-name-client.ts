import type { DocumentWireRow } from '@/features/documents/lib/file-item'
import { byNameResponseSchema } from './by-name-types'
import { FILENAME_LOOKUP_MAX_NAMES } from './filename-lookup'

export type ByNameFetch = (path: string, init?: RequestInit) => Promise<Response>

export class ByNameResolveError extends Error {
  constructor(readonly status: number) {
    super(`Document resolve failed (${status})`)
    this.name = 'ByNameResolveError'
  }
}

export const BY_NAME_PATH = '/api/documents/by-name'

export type ResolvedDocumentRow = DocumentWireRow & { collectionName?: string; updatedAt?: string }

export interface DocumentByNameClient {
  project: (projectId: string, names: readonly string[]) => Promise<ResolvedDocumentRow[]>
  officeShelf: (names: readonly string[]) => Promise<ResolvedDocumentRow[]>
}

function chunks(names: readonly string[]): string[][] {
  const unique = [...new Set(names.filter((name) => name.trim().length > 0))]
  const out: string[][] = []
  for (let start = 0; start < unique.length; start += FILENAME_LOOKUP_MAX_NAMES) {
    out.push(unique.slice(start, start + FILENAME_LOOKUP_MAX_NAMES))
  }
  return out
}

export function createDocumentByNameClient(
  run: ByNameFetch = (path, init) => fetch(path, init),
): DocumentByNameClient {
  const post = async (path: string, body: Record<string, unknown>): Promise<ResolvedDocumentRow[]> => {
    let response: Response
    try {
      response = await run(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw new ByNameResolveError(0)
    }
    if (!response.ok) throw new ByNameResolveError(response.status)
    return byNameResponseSchema.parse(await response.json()).documents as unknown as ResolvedDocumentRow[]
  }
  const batched = async (path: string, names: readonly string[], extra: Record<string, unknown>) =>
    (await Promise.all(chunks(names).map((batch) => post(path, { ...extra, names: batch })))).flat()
  return {
    project: (projectId, names) => batched(BY_NAME_PATH, names, { projectId }),
    officeShelf: (names) => batched(BY_NAME_PATH, names, { scope: 'office_shelf' }),
  }
}
