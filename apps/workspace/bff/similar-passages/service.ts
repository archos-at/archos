import 'server-only'
import { getAccessibleDocument } from '@/lib/documents/access'
import { hasPassedScreening, SCREENED_ONLY } from '@/lib/documents/document-reader'
import { BACKEND_SEARCH_MAX_COLLECTIONS, hydrateProjectHits, joinHitsToFiles, planProjectSearch, projectsWithinCollectionCap, type BackendSearchHit, type ProjectSearchPlan, type SearchedDocument } from '@/lib/documents/semantic-search'
import type { ListedDocument } from '@/lib/documents/shelf-listing'
import { toListedDocuments } from '@/lib/documents/shelf-listing'
import { officeShelfCollectionName } from '@/lib/office-shelf/collection'
import { findOfficeShelfDocumentsByFilenames } from '@/lib/office-shelf/repository'
import { BadRequestError, ServiceUnavailableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBackendUrl } from '@/lib/backend-proxy'
import { rankBySimilarity } from '@/lib/cross-project/similarity'
import { CROSS_PROJECT_PAGE_PROJECTS } from '@/lib/cross-project/types'
import type { Project } from '@/lib/db/schema/projects'
import { revisionTag } from '@/lib/documents/revision-timeline'
import { listChatProjects } from '@/lib/projects/service'
import { toProjectStatus } from '@/lib/projects/project-status'
import { buildRequestContextWireHeaders } from '@/lib/request-context'
import { signedScopeEntries } from '@/lib/retrieval-scope/base-entry'
import type {
  SimilarDocument,
  SimilarGroup,
  SimilarPassagesRequest,
  SimilarPassagesResponse,
} from './types'

export const SIMILAR_MAX_PROJECTS = CROSS_PROJECT_PAGE_PROJECTS
export const SIMILAR_DOCUMENTS = 12
export const SIMILAR_PASSAGES_PER_DOCUMENT = 3
const PLAN_CONCURRENCY = 4
const BACKEND_TIMEOUT_MS = 15_000

function baseCollectionName(): string {
  return process.env.BASE_COLLECTION_NAME || 'oib_knowledge'
}

interface ResolvedSource {
  collection: string
  fileName: string
  documentId: string | null
  projectId: string | null
}

async function resolveSource(
  session: AuthorizedSession,
  document: SimilarPassagesRequest['document']
): Promise<ResolvedSource> {
  if (document.kind === 'base') {
    return { collection: baseCollectionName(), fileName: document.fileName, documentId: null, projectId: null }
  }
  const row = await getAccessibleDocument(session, document.documentId)
  if (!hasPassedScreening(row)) {
    throw new BadRequestError('This document has not passed screening yet', { reason: 'held' })
  }
  return { collection: row.collectionName, fileName: row.filename, documentId: row.id, projectId: row.projectId }
}

async function mapBounded<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let start = 0; start < items.length; start += limit) {
    results.push(...(await Promise.all(items.slice(start, start + limit).map(work))))
  }
  return results
}

export function otherProjectsToSearch(reach: readonly Project[], current: Pick<Project, 'id' | 'profile'> | null): Project[] {
  const others = reach.filter((project) => project.id !== current?.id)
  return rankBySimilarity(current?.profile ?? null, others).slice(0, SIMILAR_MAX_PROJECTS - (current ? 1 : 0))
}

interface BackendSimilarDocument {
  collection: string
  file_name: string
  passages: Array<{ chunk_id: string; snippet: string; page_number: number | null; score: number }>
}

interface BackendSimilarResponse {
  documents: BackendSimilarDocument[]
  origin: 'point' | 'embedded'
}

async function fetchSimilarFromBackend(
  organizationId: string,
  source: ResolvedSource,
  passage: SimilarPassagesRequest['passage'],
  collections: readonly string[]
): Promise<BackendSimilarResponse> {
  const scope = [...new Set([source.collection, ...collections])]
  const headers = buildRequestContextWireHeaders({ collectionScope: await signedScopeEntries(scope, organizationId), organizationId }, process.env.INTERNAL_API_TOKEN)
  let res: Response
  try {
    res = await fetch(`${getBackendUrl()}/v1/collections/similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        source: {
          collection: source.collection,
          file_name: source.fileName,
          text: passage.text,
          page: passage.page ?? null,
          kind: passage.cited ? 'cited' : 'selected',
          document_id: source.documentId,
        },
        collections,
        documents: SIMILAR_DOCUMENTS,
        passages_per_document: SIMILAR_PASSAGES_PER_DOCUMENT,
      }),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    })
  } catch {
    throw new ServiceUnavailableError('Similar passages could not be searched')
  }
  if (!res.ok) throw new ServiceUnavailableError('Similar passages could not be searched')
  const body = (await res.json().catch(() => null)) as Partial<BackendSimilarResponse> | null
  if (!body || !Array.isArray(body.documents)) throw new ServiceUnavailableError('Similar passages could not be searched')
  const allowed = new Set(collections)
  return {
    origin: body.origin === 'point' ? 'point' : 'embedded',
    documents: body.documents.filter((document) => allowed.has(document.collection)),
  }
}

export function asSearchHits(documents: readonly BackendSimilarDocument[]): BackendSearchHit[] {
  return documents.flatMap((document, rank) =>
    document.passages.map((passage) => ({
      file_name: document.file_name,
      collection: document.collection,
      snippet: passage.snippet,
      page_number: passage.page_number,
      score: passage.score,
      rank,
    }))
  )
}

async function hydrateOfficeShelfHits(
  session: AuthorizedSession,
  hits: BackendSearchHit[]
): Promise<Array<SearchedDocument<ListedDocument>>> {
  if (hits.length === 0) return []
  const rows = await findOfficeShelfDocumentsByFilenames(
    session.organizationId,
    hits.map((hit) => hit.file_name),
    { reader: SCREENED_ONLY }
  )
  return joinHitsToFiles(hits, await toListedDocuments(session, rows, SCREENED_ONLY))
}

interface RankedDocument {
  rank: number
  document: SimilarDocument
}

export function foldDocuments(
  found: ReadonlyArray<SearchedDocument<ListedDocument>>,
  excludedDocumentId: string | null
): RankedDocument[] {
  const byId = new Map<string, RankedDocument>()
  for (const row of found) {
    if (row.id === excludedDocumentId || row.revision?.supersededBy) continue
    const entry =
      byId.get(row.id) ??
      ({
        rank: row.rank ?? Number.MAX_SAFE_INTEGER,
        document: {
          documentId: row.id,
          filename: row.filename,
          displayName: row.displayName && row.displayName !== row.filename ? row.displayName : null,
          contentType: row.contentType,
          stand: revisionTag(row.filename, row.revisionFacts ?? null),
          passages: [],
        },
      } satisfies RankedDocument)
    byId.set(row.id, entry)
    entry.document.passages.push({ page: row.page, snippet: row.snippet, score: row.score })
  }
  return [...byId.values()].sort((a, b) => a.rank - b.rank)
}

function joinFailed(error: unknown): never {
  console.warn('[SimilarPassages] could not join the hits to their documents', error)
  throw new ServiceUnavailableError('Similar passages could not be searched')
}

const bestRank = (documents: readonly RankedDocument[]): number =>
  documents.reduce((best, entry) => Math.min(best, entry.rank), Number.MAX_SAFE_INTEGER)

export async function findSimilarPassages(
  session: AuthorizedSession,
  request: SimilarPassagesRequest
): Promise<SimilarPassagesResponse> {
  const source = await resolveSource(session, request.document)
  const currentId = source.projectId ?? request.projectId ?? null
  const [currentPlan, reach] = await Promise.all([
    currentId ? planProjectSearch(session, currentId).catch(() => null) : Promise.resolve(null),
    listChatProjects(session),
  ])
  const planned = await mapBounded(
    otherProjectsToSearch(reach, currentPlan?.project ?? null),
    PLAN_CONCURRENCY,
    (project) => planProjectSearch(session, project.id).catch(() => null)
  )
  const candidates = [currentPlan, ...planned].filter((plan): plan is ProjectSearchPlan => plan !== null)
  const projectCap = BACKEND_SEARCH_MAX_COLLECTIONS - 1
  const plans = candidates.slice(
    0,
    projectsWithinCollectionCap(
      candidates.map((plan) => plan.collections.length),
      projectCap
    )
  )
  const officeShelf = officeShelfCollectionName(session.organizationId)
  const collections = [...new Set([...plans.flatMap((plan) => plan.collections).slice(0, projectCap), officeShelf])]

  const backend = await fetchSimilarFromBackend(session.organizationId, source, request.passage, collections)
  const hits = asSearchHits(backend.documents)

  const projectGroups = await mapBounded(plans, PLAN_CONCURRENCY, async (plan) => {
    const own = new Set(plan.collections)
    const projectHits = hits.filter((hit) => own.has(hit.collection))
    if (projectHits.length === 0) return null
    const found = await hydrateProjectHits(session, plan, projectHits, { forModel: true }).catch(joinFailed)
    const documents = foldDocuments(found, source.documentId)
    if (documents.length === 0) return null
    return { plan, documents }
  })
  const officeShelfDocuments = foldDocuments(
    await hydrateOfficeShelfHits(
      session,
      hits.filter((hit) => hit.collection === officeShelf)
    ).catch(joinFailed),
    source.documentId
  )

  const ranked: Array<{ rank: number; group: SimilarGroup }> = []
  for (const entry of projectGroups) {
    if (!entry) continue
    const project = entry.plan.project
    ranked.push({
      rank: entry.plan === currentPlan ? -1 : bestRank(entry.documents),
      group: {
        kind: entry.plan === currentPlan ? 'current' : 'project',
        project: { id: project.id, name: project.name, status: toProjectStatus(project.status) },
        documents: entry.documents.map((document) => document.document),
      },
    })
  }
  if (officeShelfDocuments.length > 0) {
    ranked.push({
      rank: bestRank(officeShelfDocuments),
      group: { kind: 'office_shelf', project: null, documents: officeShelfDocuments.map((document) => document.document) },
    })
  }
  ranked.sort((a, b) => a.rank - b.rank)
  return {
    groups: ranked.map((entry) => entry.group),
    projectsSearched: plans.filter((plan) => plan !== currentPlan).length,
    origin: backend.origin,
  }
}
