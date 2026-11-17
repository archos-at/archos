import {
  NAME_PROBE_MAX_NAMES,
  revisionCandidatesResponseSchema,
  nameProbeResponseSchema,
  type DocumentNameMatch,
  type RevisionCandidateMatch,
} from './name-probe-types'

export type NameProbeFetch = (path: string, init?: RequestInit) => Promise<Response>

export class NameProbeError extends Error {
  constructor(readonly status: number) {
    super(`Name probe failed (${status})`)
    this.name = 'NameProbeError'
  }
}

export const NAME_PROBE_PATH = '/api/documents/name-matches'
export const REVISION_CANDIDATES_PATH = '/api/documents/revision-candidates'
const OFFICE_SHELF = { scope: 'office_shelf' } as const

export interface DocumentNameProbeClient {
  project: (projectId: string, names: readonly string[]) => Promise<DocumentNameMatch[]>
  officeShelf: (names: readonly string[]) => Promise<DocumentNameMatch[]>
  projectRevisions: (
    projectId: string,
    names: readonly string[],
    landsIn?: ReadonlyMap<string, string | null>,
  ) => Promise<RevisionCandidateMatch[]>
  officeShelfRevisions: (names: readonly string[]) => Promise<RevisionCandidateMatch[]>
}

function chunks(names: readonly string[]): string[][] {
  const unique = [...new Set(names.filter((name) => name.length > 0))]
  const out: string[][] = []
  for (let start = 0; start < unique.length; start += NAME_PROBE_MAX_NAMES) {
    out.push(unique.slice(start, start + NAME_PROBE_MAX_NAMES))
  }
  return out
}

function uniqueById(matches: readonly DocumentNameMatch[]): DocumentNameMatch[] {
  return [...new Map(matches.map((match) => [match.id, match])).values()]
}

export function createDocumentNameProbeClient(
  run: NameProbeFetch = (path, init) => fetch(path, init),
): DocumentNameProbeClient {
  const send = async (path: string, body: unknown): Promise<unknown> => {
    const response = await run(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new NameProbeError(response.status)
    return response.json()
  }
  const post = async (path: string, body: unknown): Promise<DocumentNameMatch[]> =>
    nameProbeResponseSchema.parse(await send(path, body)).documents
  const batched = async (path: string, names: readonly string[], extra: Record<string, unknown>) =>
    uniqueById((await Promise.all(chunks(names).map((batch) => post(path, { ...extra, names: batch })))).flat())
  const candidates = async (
    path: string,
    names: readonly string[],
    extra: Record<string, unknown>,
    landsIn?: ReadonlyMap<string, string | null>
  ) => {
    const foldersOf = (batch: readonly string[]) =>
      landsIn
        ? { folders: Object.fromEntries(batch.filter((name) => landsIn.has(name)).map((name) => [name, landsIn.get(name) ?? null])) }
        : {}
    const answers = await Promise.all(
      chunks(names).map(async (batch) =>
        revisionCandidatesResponseSchema.parse(await send(path, { ...extra, names: batch, ...foldersOf(batch) })).candidates
      )
    )
    return [...new Map(answers.flat().map((candidate) => [candidate.name, candidate])).values()]
  }
  return {
    project: (projectId, names) => batched(NAME_PROBE_PATH, names, { projectId }),
    officeShelf: (names) => batched(NAME_PROBE_PATH, names, OFFICE_SHELF),
    projectRevisions: (projectId, names, landsIn) => candidates(REVISION_CANDIDATES_PATH, names, { projectId }, landsIn),
    officeShelfRevisions: (names) => candidates(REVISION_CANDIDATES_PATH, names, OFFICE_SHELF),
  }
}
