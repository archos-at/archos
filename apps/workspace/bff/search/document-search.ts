import 'server-only'
import { hitDocumentId } from '@/lib/documents/legacy-search-hit'
import { BadRequestError, UnprocessableError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { documentReadFamily } from '@/lib/documents/document-status'
import { BACKEND_SEARCH_MAX_COLLECTIONS, fetchGroupedSemanticHits, type BackendSearchHit, type GroupedSearchFilters } from '@/lib/documents/semantic-search'
import { resolvePeople } from '@/lib/sharing/directory'
import {
  contentKey,
  countUnreadDocuments,
  documentFacetCounts,
  listCandidateDocuments,
  readReferenceSubject,
  searchDocumentPage,
  type DocumentQuery,
  type DocumentSearchRow,
  type FacetKey,
  type ReferenceTargets,
} from './document-repository'
import { narrowReach, reachCollections, reachFor, reachShelves, resolveScope, type SearchReach } from './reach'
import {
  SEARCH_KINDS,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_OFFSET_MAX,
  SEARCH_SECTION_PREVIEW,
  setAsideKinds,
  type DocumentFilters,
  type DocumentHit,
  type FacetCount,
  type SearchBody,
  type SearchFacetDimension,
  type SearchKind,
  type SearchResponse,
  type SearchScopeQuery,
  type SearchSection,
  type SearchSort,
} from './search-wire'
import { searchAnnotations, searchConversations, searchFolders, searchProjects } from './providers'
import { refreshStaleShelves } from './shelf-projection'

const CONTENT_FILES_PER_COLLECTION = 20
const CONTENT_CANDIDATES = 200
const PREFILTER_MAX_IDS = 1000
const PASSAGE_CHARS = 400
const CONTENT_MIN_CHARS = 3

const ASCENDING_BY_DEFAULT: ReadonlySet<SearchSort> = new Set(['name', 'plan_number', 'plan_index', 'document_type', 'project'])

const FACET_KEYS: Record<SearchFacetDimension, FacetKey> = {
  documentType: 'documentType',
  tag: 'tag',
  project: 'project',
  partyRole: 'partyRole',
  municipality: 'municipality',
  cites: 'cites',
  state: 'status',
  fileType: 'fileType',
  uploader: 'uploader',
  changedFact: 'changedFact',
}

export function narrowedTo(reach: SearchReach, body: Pick<SearchBody, 'filters'>): SearchReach {
  const projectIds = body.filters?.projectIds ?? []
  return projectIds.length > 0 ? narrowReach(reach, projectIds) : reach
}

export function encodeSearchCursor(kind: SearchKind, offset: number): string {
  return Buffer.from(JSON.stringify({ k: kind, o: offset })).toString('base64url')
}

export function decodeSearchCursor(cursor: string, kind: SearchKind): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { k?: unknown; o?: unknown }
    if (parsed.k === kind && typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0 && parsed.o <= SEARCH_OFFSET_MAX) {
      return parsed.o
    }
  } catch {
    // Falls through to the refusal: a cursor this API did not write.
  }
  throw new BadRequestError('cursor is not a nextCursor of this search with this single kind')
}

export function documentOrder(body: Pick<SearchBody, 'sort' | 'dir' | 'text'>): { sort: SearchSort; dir: 'asc' | 'desc' } {
  const hasText = Boolean(body.text?.trim())
  const sort = body.sort === 'relevance' && !hasText ? 'added' : (body.sort ?? (hasText ? 'relevance' : 'added'))
  return { sort, dir: body.dir ?? (ASCENDING_BY_DEFAULT.has(sort) ? 'asc' : 'desc') }
}

async function referenceTargets(reach: SearchReach, documentId: string, direction: 'citedBy' | 'citing'): Promise<ReferenceTargets | null> {
  const subject = await readReferenceSubject(reach, documentId)
  if (!subject) return null
  if (direction === 'citing') {
    return { planKeys: subject.planNumberKey ? [subject.planNumberKey] : [], documentTypes: subject.documentType ? [subject.documentType] : [] }
  }
  const planKeys = subject.referenceTokens
    .filter((token) => token.startsWith('plan:'))
    .map((token) => token.slice('plan:'.length).replace(/[\s\-_]+/g, ''))
  const documentTypes = subject.referenceTokens.filter((token) => token.startsWith('document:')).map((token) => token.slice('document:'.length))
  return { planKeys, documentTypes }
}

export async function contentPrefilter(
  reach: SearchReach,
  query: DocumentQuery
): Promise<{ filters: GroupedSearchFilters | undefined } | null> {
  const narrowed = Object.entries(query.filters).some(([key, value]) => key !== 'includeArchived' && value !== undefined)
  if (!narrowed && !query.citedBy && !query.citing && !reach.folderIds) return { filters: undefined }
  const candidates = await listCandidateDocuments(reach, query, PREFILTER_MAX_IDS)
  if (candidates.length === 0) return null
  if (candidates.length <= PREFILTER_MAX_IDS) {
    const names = [...new Set(candidates.flatMap((candidate) => (candidate.filename ? [candidate.filename] : [])))]
    return {
      filters: {
        document_ids: candidates.map((candidate) => candidate.id),
        ...(names.length > 0 ? { file_names: names } : {}),
      },
    }
  }
  const readingTypes = query.filters.documentTypes ?? []
  const refersTo = (query.filters.cites ?? []).slice(0, 8)
  if (readingTypes.length === 0 && refersTo.length === 0) return { filters: undefined }
  return {
    filters: {
      ...(readingTypes.length > 0 ? { reading_types: [...readingTypes] } : {}),
      ...(refersTo.length > 0 ? { refers_to: refersTo } : {}),
    },
  }
}

interface ContentResult {
  hits: BackendSearchHit[] | null
  partial: boolean
  ms: number
}

const NO_CONTENT: ContentResult = { hits: [], partial: false, ms: 0 }

async function contentHits(
  reach: SearchReach,
  text: string,
  filters: GroupedSearchFilters | undefined
): Promise<ContentResult> {
  const collections = reachCollections(reach)
  if (collections.length === 0) return NO_CONTENT
  const named = collections.slice(0, BACKEND_SEARCH_MAX_COLLECTIONS)
  const started = performance.now()
  try {
    const hits = await fetchGroupedSemanticHits(reach.organizationId, named, text, CONTENT_FILES_PER_COLLECTION, PASSAGE_CHARS, {
      ...(filters ? { filters } : {}),
      purpose: 'workspace_search',
    })
    return { hits, partial: named.length < collections.length, ms: performance.now() - started }
  } catch (error) {
    if (error instanceof UpstreamError) return { hits: null, partial: true, ms: performance.now() - started }
    throw error
  }
}

function toDocumentHit(row: DocumentSearchRow, passage: BackendSearchHit | undefined, uploader: string | null): DocumentHit {
  return {
    kind: 'document',
    id: row.id,
    name: row.displayName ?? row.filename,
    filename: row.filename,
    shelf: row.scope === 'office_shelf' ? 'office_shelf' : 'project',
    projectId: row.projectId,
    projectName: row.projectName,
    folderId: row.folderId,
    folderName: row.folderName,
    folderPath: row.folderPath,
    status: row.status,
    contentType: row.contentType,
    uploadedAt: row.createdAt.toISOString(),
    uploadedBy: uploader,
    documentType: row.documentType,
    title: row.title,
    planNumber: row.planNumber,
    planIndex: row.planIndex,
    planDate: row.planDate,
    scale: row.scale,
    documentDate: row.documentDate,
    pageCount: row.pageCount,
    pagesNotRead: row.pagesNotRead,
    superseded: row.superseded,
    changedFacts: row.changedFacts,
    municipality: row.municipality,
    author: row.author,
    matchedOn: [
      ...(row.matchedName ? (['name'] as const) : []),
      ...(row.matchedReading ? (['reading'] as const) : []),
      ...(passage ? ([passage.lexical === false ? 'meaning' : 'content'] as const) : []),
    ],
    passage: passage ? { text: passage.snippet, page: passage.page_number ?? null } : null,
  }
}

function labelFacets(
  reach: SearchReach,
  counts: Record<string, Array<{ value: string; count: number }>>,
  dimensions: readonly SearchFacetDimension[],
  people: ReadonlyMap<string, { name: string | null }>
): Partial<Record<SearchFacetDimension, FacetCount[]>> {
  const projectNames = new Map(reach.projects.map((reached) => [reached.project.id, reached.project.name]))
  const out: Partial<Record<SearchFacetDimension, FacetCount[]>> = {}
  for (const dimension of dimensions) {
    const values = counts[FACET_KEYS[dimension]] ?? []
    if (dimension === 'state') {
      const families = new Map<string, number>()
      for (const { value, count } of values) families.set(documentReadFamily(value), (families.get(documentReadFamily(value)) ?? 0) + count)
      out.state = [...families].map(([value, count]) => ({ value, label: null, count })).sort((a, b) => b.count - a.count)
      continue
    }
    out[dimension] = values.map(({ value, count }) => ({
      value,
      label:
        dimension === 'project'
          ? (projectNames.get(value) ?? null)
          : dimension === 'cites'
            ? value.slice(value.indexOf(':') + 1)
            : dimension === 'uploader'
              ? (people.get(value)?.name ?? null)
              : null,
      count,
    }))
  }
  return out
}

async function rankedContent(
  reach: SearchReach,
  structured: DocumentQuery,
  text: string
): Promise<ContentResult> {
  const prefilter = await contentPrefilter(reach, structured)
  if (!prefilter) return NO_CONTENT
  return contentHits(reach, text, prefilter.filters)
}

export async function structuredQuery(reach: SearchReach, filters: DocumentFilters): Promise<Omit<DocumentQuery, 'text'> | null> {
  const [citedBy, citing] = await Promise.all([
    filters.citedBy ? referenceTargets(reach, filters.citedBy, 'citedBy') : null,
    filters.citing ? referenceTargets(reach, filters.citing, 'citing') : null,
  ])
  if ((filters.citedBy && !citedBy) || (filters.citing && !citing)) return null
  return { filters, citedBy, citing }
}

async function searchDocuments(
  reach: SearchReach,
  body: SearchBody,
  documents: Omit<DocumentQuery, 'text'> | null,
  page: { limit: number; offset: number },
  withFacets: boolean
): Promise<{ section: SearchSection<DocumentHit>; facets: SearchResponse['facets']; unread: number | null; contentPartial: boolean; contentMs: number }> {
  const unreadCount = withFacets ? countUnreadDocuments(reach, body.filters?.includeArchived === true) : Promise.resolve(null)
  unreadCount.catch(() => undefined)
  if (!documents) {
    return {
      section: { hits: [], total: 0, totalIsLowerBound: false, nextCursor: null },
      facets: withFacets ? {} : null,
      unread: await unreadCount,
      contentPartial: false,
      contentMs: 0,
    }
  }
  const text = body.text?.trim() || null
  const structured: DocumentQuery = { ...documents, text: null }
  const content = text && text.length >= CONTENT_MIN_CHARS ? await rankedContent(reach, structured, text) : NO_CONTENT
  const found = content.hits ?? []
  const passagesById = new Map(
    found.flatMap((hit) => {
      const id = hitDocumentId(hit)
      return id ? [[id, hit] as const] : []
    })
  )
  const passagesByKey = new Map(
    found.flatMap((hit) => (hitDocumentId(hit) ? [] : [[contentKey(hit.collection, hit.file_name), hit] as const]))
  )
  const query: DocumentQuery = {
    ...structured,
    text: text
      ? {
          text,
          contentKeys: found.map((hit) => (hitDocumentId(hit) ? '' : contentKey(hit.collection, hit.file_name))),
          contentIds: found.map((hit) => hitDocumentId(hit) ?? ''),
        }
      : null,
  }
  const order = documentOrder(body)
  const [result, counts] = await Promise.all([
    searchDocumentPage(reach, query, { ...order, ...page }),
    withFacets ? documentFacetCounts(reach, query, Object.values(FACET_KEYS)) : Promise.resolve(null),
  ])
  const uploaders = (counts?.uploader ?? []).map((entry) => entry.value)
  const people = await resolvePeople(reach.organizationId, [...new Set([...result.rows.map((row) => row.createdBy), ...uploaders])])
  const hits = result.rows.map((row) =>
    toDocumentHit(
      row,
      passagesById.get(row.id) ??
        (row.authoredBy === 'user' ? passagesByKey.get(contentKey(row.collectionName, row.filename)) : undefined),
      people.get(row.createdBy)?.name ?? null
    )
  )
  const nextOffset = page.offset + hits.length
  return {
    section: {
      hits,
      total: result.total,
      totalIsLowerBound: Boolean(text) && (content.partial || found.length >= CONTENT_CANDIDATES),
      nextCursor: nextOffset < result.total && nextOffset <= SEARCH_OFFSET_MAX ? encodeSearchCursor('document', nextOffset) : null,
    },
    facets: counts ? labelFacets(reach, counts, Object.keys(FACET_KEYS) as SearchFacetDimension[], people) : null,
    unread: await unreadCount,
    contentPartial: content.partial,
    contentMs: content.ms,
  }
}

function sectionOf<T extends SearchResponse['sections'][SearchKind]>(
  kind: SearchKind,
  result: { hits: NonNullable<T>['hits']; total: number },
  offset: number
): NonNullable<T> {
  const next = offset + result.hits.length
  return {
    hits: result.hits,
    total: result.total,
    totalIsLowerBound: false,
    nextCursor: next < result.total && next <= SEARCH_OFFSET_MAX ? encodeSearchCursor(kind, next) : null,
  } as NonNullable<T>
}

export interface SearchTiming {
  totalMs: number
  sqlMs: number
  contentMs: number
}

export async function runSearch(session: AuthorizedSession, scopeQuery: SearchScopeQuery, body: SearchBody): Promise<SearchResponse> {
  return (await runTimedSearch(session, scopeQuery, body)).response
}

export async function runTimedSearch(
  session: AuthorizedSession,
  scopeQuery: SearchScopeQuery,
  body: SearchBody
): Promise<{ response: SearchResponse; timing: SearchTiming }> {
  const started = performance.now()
  const scope = resolveScope(scopeQuery)
  const reach = narrowedTo(await reachFor(session, scope), body)
  const kinds = SEARCH_KINDS.filter((kind) => !body.kinds || body.kinds.includes(kind))
  const single = kinds.length === 1
  if (body.cursor && !single) throw new BadRequestError('A cursor pages one kind: ask with kinds set to that kind alone')
  const offset = body.cursor ? decodeSearchCursor(body.cursor, kinds[0]) : 0
  const limit = body.limit ?? SEARCH_LIMIT_DEFAULT
  const pageFor = (kind: SearchKind) => ({ limit: single || kind === 'document' ? limit : Math.min(limit, SEARCH_SECTION_PREVIEW), offset })
  const text = body.text?.trim() || null
  const setAside = setAsideKinds(body)
  const searched = kinds.filter((kind) => !setAside[kind])
  const documents = searched.includes('document') || searched.includes('annotation') ? await structuredQuery(reach, body.filters ?? {}) : null

  const freshness = refreshStaleShelves(reach.organizationId, reachShelves(reach))
  const sections: SearchResponse['sections'] = {}
  let facets: SearchResponse['facets'] = null
  let unread: number | null = null
  let contentPartial = false
  let contentMs = 0
  await Promise.all(
    searched.map(async (kind) => {
      if (kind === 'document') {
        const found = await searchDocuments(reach, body, documents, pageFor(kind), body.facets !== false && offset === 0)
        sections.document = found.section
        facets = found.facets
        unread = found.unread
        contentPartial = found.contentPartial
        contentMs = found.contentMs
        return
      }
      if (kind === 'annotation') {
        if (!text && !body.annotationFilters) return
        sections.annotation = documents
          ? sectionOf('annotation', await searchAnnotations(reach, text, body.annotationFilters ?? {}, documents, pageFor(kind)), offset)
          : sectionOf('annotation', { hits: [], total: 0 }, offset)
        return
      }
      if (!text) return
      if (kind === 'folder') sections.folder = sectionOf('folder', await searchFolders(reach, text, pageFor(kind)), offset)
      if (kind === 'project') sections.project = sectionOf('project', await searchProjects(reach, text, pageFor(kind)), offset)
      if (kind === 'conversation') {
        sections.conversation = sectionOf('conversation', await searchConversations(session, reach, text, pageFor(kind)), offset)
      }
    })
  )
  const response: SearchResponse = { scope, setAside, sections, facets, unread, building: (await freshness).building, contentPartial }
  const totalMs = performance.now() - started
  return { response, timing: { totalMs, contentMs, sqlMs: Math.max(0, totalMs - contentMs) } }
}

export function serverTimingHeader(timing: SearchTiming): string {
  const dur = (ms: number) => Math.round(ms * 10) / 10
  return `sql;dur=${dur(timing.sqlMs)}, content;dur=${dur(timing.contentMs)}, total;dur=${dur(timing.totalMs)}`
}

export async function listSearchDocumentsForExport(
  session: AuthorizedSession,
  scopeQuery: SearchScopeQuery,
  body: SearchBody,
  max: number
): Promise<{ scope: SearchReach['scope']; hits: DocumentHit[] }> {
  const reach = narrowedTo(await reachFor(session, resolveScope(scopeQuery)), body)
  const documents = await structuredQuery(reach, body.filters ?? {})
  const { section } = await searchDocuments(reach, { ...body, cursor: undefined }, documents, { limit: max + 1, offset: 0 }, false)
  if (section.hits.length > max) {
    throw new UnprocessableError(`A plan list carries at most ${max} documents; narrow the search with a filter.`, {
      reason: 'too-many-documents',
    })
  }
  return { scope: reach.scope, hits: section.hits }
}
