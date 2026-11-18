import 'server-only'
import { getProjectFolderAccess } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getBackendUrl } from '@/lib/backend-proxy'
import { buildRequestContextWireHeaders } from '@/lib/request-context'
import { findProjectInOrg } from '@/lib/projects/repository'
import type { ProjectFactsWire, SearchBoostWire } from '@/lib/cross-project/project-facts-mirror'
import { NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Project } from '@/lib/db/schema/projects'
import { toListedDocuments, type ListedDocument } from './shelf-listing'
import { findProjectDocumentsByFilenames } from './repository'
import { SCREENED_ONLY } from './document-reader'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { BACKEND_FETCH_TIMEOUT_MS } from './ingest-dispatch'
import { signedScopeEntries } from '@/lib/retrieval-scope/base-entry'

export interface BackendSearchHit {
  file_name: string
  score: number
  snippet: string
  page_number: number | null
  collection: string
  rank?: number
  document_id?: string
  grid_document_id?: string
  lexical?: boolean | null
}

export type SearchedDocument<T> = T & {
  snippet: string
  page: number | null
  score: number
  rank?: number
}

export async function fetchGroupedSemanticHits(
  organizationId: string,
  collections: readonly string[],
  query: string,
  filesPerCollection: number,
  snippetMaxChars?: number,
  options: GroupedSearchOptions = {}
): Promise<BackendSearchHit[]> {
  const unique = [...new Set(collections)]
  if (unique.length === 0) return []
  const scopeHeaders = buildRequestContextWireHeaders(
    { collectionScope: await signedScopeEntries(unique, organizationId), organizationId },
    process.env.INTERNAL_API_TOKEN
  )
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/collections/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...scopeHeaders },
      body: JSON.stringify({
        query,
        collections: unique,
        groups: Math.min(unique.length, GROUPED_SEARCH_MAX_GROUPS),
        files_per_group: Math.min(Math.max(1, filesPerCollection), GROUPED_SEARCH_MAX_FILES_PER_GROUP),
        ...(snippetMaxChars ? { snippet_max_chars: snippetMaxChars } : {}),
        ...(options.filters ? { filters: options.filters } : {}),
        ...(options.boost ? { boost: options.boost } : {}),
        ...(options.purpose ? { purpose: options.purpose } : {}),
      }),
      signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError('Grouped search backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (!res.ok) throw new UpstreamError(`Grouped search backend returned ${res.status}`)
  const body = await res.json().catch(() => null)
  if (!Array.isArray(body?.hits)) throw new UpstreamError('Grouped search backend returned an unexpected shape')
  const allowed = new Set(unique)
  return (body.hits as BackendSearchHit[])
    .filter((hit) => allowed.has(hit.collection))
    .map((hit, rank) => ({ ...hit, rank }))
}

const GROUPED_SEARCH_MAX_GROUPS = 200

const GROUPED_SEARCH_MAX_FILES_PER_GROUP = 20

export const BACKEND_SEARCH_MAX_COLLECTIONS = 500

export function projectsWithinCollectionCap(sizes: readonly number[], cap = BACKEND_SEARCH_MAX_COLLECTIONS): number {
  let total = 0
  for (const [index, size] of sizes.entries()) {
    total += size
    if (total > cap) return Math.max(index, 1)
  }
  return sizes.length
}

export interface GroupedSearchFilters {
  document_types?: string[]
  disciplines?: string[]
  project_facts?: Partial<ProjectFactsWire>
  project_status?: Array<'active' | 'paused' | 'closed'>
  document_ids?: string[]
  file_names?: string[] // The same documents' names, for passages without `grid_document_id`: any of the ids or these.
  reading_types?: string[]
  refers_to?: string[]
}

export interface GroupedSearchOptions {
  filters?: GroupedSearchFilters
  boost?: SearchBoostWire | null
  purpose?: 'workspace_search'
}

function collectionFileKey(collectionName: string, filename: string): string {
  return JSON.stringify([collectionName, filename])
}

export function joinHitsToFiles<
  T extends { filename: string; collectionName: string; createdAt: Date | string; authoredBy: string },
>(hits: BackendSearchHit[], files: T[]): Array<SearchedDocument<T>> {
  const byName = new Map<string, T>()
  for (const file of files) {
    if (file.authoredBy !== 'user') continue
    const key = collectionFileKey(file.collectionName, file.filename)
    const existing = byName.get(key)
    if (!existing || new Date(file.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      byName.set(key, file)
    }
  }

  const matched: Array<SearchedDocument<T>> = []
  for (const hit of hits) {
    const file = byName.get(collectionFileKey(hit.collection, hit.file_name))
    if (!file) continue
    matched.push({
      ...file,
      snippet: hit.snippet,
      page: hit.page_number ?? null,
      score: hit.score,
      ...(hit.rank === undefined ? {} : { rank: hit.rank }),
    })
  }
  return matched
}

export interface ProjectSearchOptions {
  forModel?: boolean
}

export interface ProjectSearchPlan {
  project: Project
  access: Awaited<ReturnType<typeof getProjectFolderAccess>>
  collections: string[]
}

export async function planProjectSearch(session: AuthorizedSession, projectId: string): Promise<ProjectSearchPlan> {
  await requireProjectAccess(session, projectId, 'project:view')

  const project = await findProjectInOrg(projectId, session.organizationId)
  if (!project) throw new NotFoundError('Project not found')

  const access = await getProjectFolderAccess(session, projectId, project.collectionName)
  return { project, access, collections: [project.collectionName, ...access.clearedRestrictedCollections] }
}

export async function hydrateProjectHits(
  session: AuthorizedSession,
  plan: ProjectSearchPlan,
  hits: BackendSearchHit[],
  options: ProjectSearchOptions = {}
): Promise<Array<SearchedDocument<ListedDocument>>> {
  const allowed = new Set(plan.collections)
  const own = hits.filter((hit) => allowed.has(hit.collection))
  if (own.length === 0) return []
  const projectId = plan.project.id
  const reader = options.forModel ? SCREENED_ONLY : await shelfReaderFor(session, { scope: 'project', projectId })
  const rows = await findProjectDocumentsByFilenames(
    projectId,
    session.organizationId,
    own.map((hit) => hit.file_name),
    { hiddenFolderIds: [...plan.access.hiddenFolderIds], reader }
  )
  const joined = joinHitsToFiles(own, await toListedDocuments(session, rows, reader))
  return options.forModel ? joined.filter((row) => !row.revision?.supersededBy) : joined
}
