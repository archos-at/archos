import { byNameResponseSchema } from './by-name-types'
import type { ByNameFetch, ResolvedDocumentRow } from './by-name-client'
import { DOCUMENT_ID_LOOKUP_MAX_IDS } from './by-id-types'

export class ByIdResolveError extends Error {
  constructor(readonly status: number) {
    super(`Document resolve failed (${status})`)
    this.name = 'ByIdResolveError'
  }
}

export const BY_ID_PATH = '/api/documents/by-id'

export interface DocumentByIdClient {
  project: (projectId: string, ids: readonly string[]) => Promise<ResolvedDocumentRow[]>
  officeShelf: (ids: readonly string[]) => Promise<ResolvedDocumentRow[]>
}

function chunks(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids.filter((id) => id.length > 0))]
  const out: string[][] = []
  for (let start = 0; start < unique.length; start += DOCUMENT_ID_LOOKUP_MAX_IDS) {
    out.push(unique.slice(start, start + DOCUMENT_ID_LOOKUP_MAX_IDS))
  }
  return out
}

export function createDocumentByIdClient(run: ByNameFetch = (path, init) => fetch(path, init)): DocumentByIdClient {
  const post = async (body: Record<string, unknown>): Promise<ResolvedDocumentRow[]> => {
    let response: Response
    try {
      response = await run(BY_ID_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw new ByIdResolveError(0)
    }
    if (!response.ok) throw new ByIdResolveError(response.status)
    return byNameResponseSchema.parse(await response.json()).documents as unknown as ResolvedDocumentRow[]
  }
  const batched = async (ids: readonly string[], extra: Record<string, unknown>) =>
    (await Promise.all(chunks(ids).map((batch) => post({ ...extra, ids: batch })))).flat()
  return {
    project: (projectId, ids) => batched(ids, { projectId }),
    officeShelf: (ids) => batched(ids, { scope: 'office_shelf' }),
  }
}
