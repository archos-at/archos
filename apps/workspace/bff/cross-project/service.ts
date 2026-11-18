import 'server-only'
import { decisionOriginOf } from './decision-origin'
import { BadRequestError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { clearanceOf, readableFolderIdsFor } from '@/lib/authz/folder-access'
import { recordCrossProjectHandOut, type HandOutParty } from '@/lib/conversations/cross-project-use'
import type { Project } from '@/lib/db/schema/projects'
import type { ListedDocument } from '@/lib/documents/document-listing'
import { BACKEND_SEARCH_MAX_COLLECTIONS, fetchGroupedSemanticHits, hydrateProjectHits, planProjectSearch, projectsWithinCollectionCap, type GroupedSearchFilters, type ProjectSearchPlan, type SearchedDocument } from '@/lib/documents/semantic-search'
import { similarityBoostOf } from './project-facts-mirror'
import { buildProjectPromptView } from '@/lib/project-profile/prompt-view'
import { findProjectInOrg } from '@/lib/projects/repository'
import { audienceReach, type AudienceReach } from './audience-reach'
import { searchProjectDecisions, type DecisionScope, type FoundDecision } from './decisions-repository'
import { liveFolderAccess } from '@/lib/permits/live-access'
import { searchPermitRequirements, type FoundPermitRecord } from '@/lib/permits/repository'
import { federalStateOf, rankBySimilarity, similarityFacts } from './similarity'
import { closingOf, toProjectStatus } from '@/lib/projects/project-status'
import type { VerifiedRequestContext } from '@/lib/request-context'
import {
  CROSS_PROJECT_PAGE_PROJECTS,
  type CrossProjectBriefRequest,
  type CrossProjectBriefResponse,
  type CrossProjectDecision,
  type CrossProjectFacts,
  type CrossProjectHit,
  type CrossProjectListed,
  type CrossProjectRef,
  type CrossProjectListRequest,
  type CrossProjectListResponse,
  type CrossProjectPermit,
  type CrossProjectSearchRequest,
  type CrossProjectSearchResponse,
  type ProjectStatus,
} from './types'

export const SEARCH_CONCURRENCY = 4

export const CROSS_PROJECT_SNIPPET_CHARS = 900

export interface CrossProjectCaller {
  session: AuthorizedSession
  conversationId: string
  currentProjectId: string | null
  answerMessageId?: string | null
}

export function crossProjectCaller(
  context: Pick<VerifiedRequestContext, 'conversationId' | 'projectId'>,
  session: AuthorizedSession,
  answerMessageId?: string | null
): CrossProjectCaller {
  if (!context.conversationId) throw new BadRequestError('A cross-project lookup needs the conversation it was asked in')
  return {
    session,
    conversationId: context.conversationId,
    currentProjectId: context.projectId ?? null,
    answerMessageId: answerMessageId ?? null,
  }
}

function party(caller: CrossProjectCaller): HandOutParty {
  return {
    organizationId: caller.session.organizationId,
    userId: caller.session.userId,
    conversationId: caller.conversationId,
    answerMessageId: caller.answerMessageId,
  }
}

export function projectStatusOf(project: Pick<Project, 'status'>): ProjectStatus {
  return toProjectStatus(project.status)
}

export function projectPeriodOf(
  project: Pick<Project, 'createdAt' | 'startedOn' | 'endedOn' | 'status'>
): { start: string; end: string | null } {
  const start = project.startedOn ?? new Date(project.createdAt).toISOString().slice(0, 10)
  return { start, end: closingOf(project) }
}

export function periodOverlaps(period: { start: string; end: string | null }, from?: string, to?: string): boolean {
  return (!to || period.start <= to) && (!from || period.end === null || period.end >= from)
}

export function projectAddressOf(project: Pick<Project, 'profile'>): string | null {
  const value = project.profile?.facts?.site_address?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function projectRefOf(project: Project): CrossProjectRef {
  return {
    id: project.id,
    name: project.name,
    status: projectStatusOf(project),
    federal_state: federalStateOf(project.profile),
  }
}

export function oibEditionOf(profile: Project['profile'] | null): CrossProjectListed['oibEdition'] {
  const fact = profile?.facts?.oib_edition?.value
  if (typeof fact === 'string' && fact.trim()) return { value: fact.trim(), confirmed: true }
  const suggestion = profile?.assumptions?.oib_edition
  if (suggestion?.source === 'agent_suggested' && typeof suggestion.value === 'string' && suggestion.value.trim()) {
    return { value: suggestion.value.trim(), confirmed: false }
  }
  return null
}

function listed(project: Project, currentProjectId: string | null): CrossProjectListed {
  return {
    ...projectRefOf(project),
    collection: project.collectionName,
    address: projectAddressOf(project),
    period: projectPeriodOf(project),
    oibEdition: oibEditionOf(project.profile),
    current: project.id === currentProjectId,
  }
}

export function holdsFacts(profile: Project['profile'] | null, filter: CrossProjectFacts | undefined): boolean {
  if (!filter) return true
  const facts = similarityFacts(profile)
  const anyOf = <T>(wanted: readonly T[] | undefined, held: readonly T[]) =>
    !wanted?.length || wanted.some((value) => held.includes(value))
  return (
    anyOf(filter.federal_state, facts.federal_state ? [facts.federal_state] : []) &&
    anyOf(filter.building_class, facts.building_class) &&
    anyOf(filter.construction_method, facts.construction_method) &&
    anyOf(filter.uses, facts.uses) &&
    anyOf(filter.work_type, facts.work_type)
  )
}

export function projectsInScope(
  reachable: readonly Project[],
  request: Pick<CrossProjectSearchRequest, 'scope' | 'projectIds' | 'from' | 'to'> &
    Partial<Pick<CrossProjectSearchRequest, 'order' | 'projectFacts'>>,
  current: { id: string; profile: Project['profile'] | null } | null
): Project[] {
  const others = reachable.filter(
    (project) =>
      project.id !== current?.id &&
      periodOverlaps(projectPeriodOf(project), request.from, request.to) &&
      holdsFacts(project.profile, request.projectFacts)
  )
  if (request.scope === 'similar') return fitFirst(rankBySimilarity(current?.profile ?? null, others), request.order)
  if (request.scope === 'closed') {
    return fitFirst(
      rankBySimilarity(
        current?.profile ?? null,
        others.filter((project) => projectStatusOf(project) === 'closed')
      ),
      request.order
    )
  }
  if (request.scope === 'named') {
    const named = new Set(request.projectIds)
    return others.filter((project) => named.has(project.id))
  }
  return others
}

function fitFirst(ranked: Project[], order: readonly string[] | undefined): Project[] {
  if (!order?.length) return ranked
  const position = new Map(order.map((id, index) => [id, index]))
  const first = ranked.filter((project) => position.has(project.id))
  first.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
  return [...first, ...ranked.filter((project) => !position.has(project.id))]
}

async function currentProjectOf(caller: CrossProjectCaller): Promise<Project | null> {
  return caller.currentProjectId ? findProjectInOrg(caller.currentProjectId, caller.session.organizationId) : null
}

export async function listLookupProjects(
  caller: CrossProjectCaller,
  request: CrossProjectListRequest
): Promise<CrossProjectListResponse> {
  const reach = await audienceReach(caller.session, caller.conversationId)
  const needle = request.query?.toLocaleLowerCase('de') ?? ''
  const matching = reach.projects.filter((project) => {
    if (request.status && projectStatusOf(project) !== request.status) return false
    if (!periodOverlaps(projectPeriodOf(project), request.from, request.to)) return false
    if (!holdsFacts(project.profile, request.projectFacts)) return false
    if (!needle) return true
    const haystack = `${project.name} ${projectAddressOf(project) ?? ''}`.toLocaleLowerCase('de')
    return haystack.includes(needle)
  })
  const projects = matching.slice(0, request.limit).map((project) => listed(project, caller.currentProjectId))
  await recordCrossProjectHandOut(
    party(caller),
    { projectIds: projects.filter((project) => !project.current).map((project) => project.id), folderIds: [] },
    reach.key
  )
  return { projects, total: matching.length }
}

export async function readProjectBrief(
  caller: CrossProjectCaller,
  request: CrossProjectBriefRequest
): Promise<CrossProjectBriefResponse> {
  const reach = await audienceReach(caller.session, caller.conversationId)
  const project =
    reach.projects.find((candidate) => candidate.id === request.projectId) ??
    (request.projectId === caller.currentProjectId ? await currentProjectOf(caller) : null)
  if (!project) throw new NotFoundError()
  let facts = ''
  try {
    facts = buildProjectPromptView(project.profile)
  } catch {
    // A profile that does not parse has no facts to tell; the name and summary still do.
  }
  const brief = {
    project: listed(project, caller.currentProjectId),
    summary: project.profileDisplay?.summary?.trim() || null,
    facts,
  }
  if (!brief.project.current) {
    await recordCrossProjectHandOut(party(caller), { projectIds: [project.id], folderIds: [] }, reach.key)
  }
  return brief
}

async function mapBounded<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let start = 0; start < items.length; start += limit) {
    results.push(...(await Promise.all(items.slice(start, start + limit).map(work))))
  }
  return results
}

export function matchesTags(
  tags: readonly string[],
  request: Pick<CrossProjectSearchRequest, 'documentTypes' | 'disciplines'>
): boolean {
  const has = (wanted: readonly string[]) => wanted.length === 0 || wanted.some((tag) => tags.includes(tag))
  return has(request.documentTypes) && has(request.disciplines)
}

interface FoundHit {
  hit: CrossProjectHit
  folderId: string | null
  rank?: number
}

async function foundHitsOf(
  project: Project,
  found: Array<SearchedDocument<ListedDocument>>,
  request: CrossProjectSearchRequest,
  reach: Pick<AudienceReach, 'restrictedFolders'>,
  accessOf: () => Promise<{ sourceFolderOf: (collection: string) => string | null | undefined }>
): Promise<FoundHit[]> {
  const ref = projectRefOf(project)
  const matching = found.filter(
    (hit) => matchesTags(hit.tags ?? [], request) && (reach.restrictedFolders || hit.collectionName === project.collectionName)
  )
  const restricted = matching.some((hit) => hit.collectionName !== project.collectionName)
  const access = restricted ? await accessOf() : null
  return matching.flatMap((hit) => {
    const folderId = hit.collectionName === project.collectionName ? null : (access?.sourceFolderOf(hit.collectionName) ?? null)
    if (hit.collectionName !== project.collectionName && !folderId) return []
    return [
      {
        folderId,
        ...(hit.rank === undefined ? {} : { rank: hit.rank }),
        hit: {
          project: ref,
          documentId: hit.id,
          filename: hit.filename,
          title: hit.displayName && hit.displayName !== hit.filename ? hit.displayName : null,
          collection: hit.collectionName,
          page: hit.page,
          snippet: hit.snippet,
          score: hit.score,
          tags: hit.tags ?? [],
          uploadedAt: new Date(hit.createdAt).toISOString(),
        },
      },
    ]
  })
}

interface SearchedPage {
  found: FoundHit[]
  searched: number
}

async function searchPage(
  session: AuthorizedSession,
  page: readonly Project[],
  request: CrossProjectSearchRequest,
  reach: Pick<AudienceReach, 'restrictedFolders'>,
  current: Pick<Project, 'profile'> | null
): Promise<SearchedPage> {
  const planned = await mapBounded(page, SEARCH_CONCURRENCY, (project) =>
    planProjectSearch(session, project.id).catch(() => null)
  )
  if (page.length > 0 && planned.every((plan) => plan === null)) {
    throw new UpstreamError('No project of the page could be authorized for the search')
  }
  const collectionsOf = (plan: ProjectSearchPlan) =>
    reach.restrictedFolders ? plan.collections : [plan.project.collectionName]
  const searched = projectsWithinCollectionCap(planned.map((plan) => (plan ? collectionsOf(plan).length : 0)))
  const plans = planned.slice(0, searched).filter((plan): plan is ProjectSearchPlan => plan !== null)
  const hits = await fetchGroupedSemanticHits(
    session.organizationId,
    plans.flatMap(collectionsOf).slice(0, BACKEND_SEARCH_MAX_COLLECTIONS),
    request.query,
    request.limit,
    CROSS_PROJECT_SNIPPET_CHARS,
    { filters: tagFiltersOf(request), boost: current ? similarityBoostOf(current.profile) : null }
  )
  const perProject = await mapBounded(plans, SEARCH_CONCURRENCY, async (plan) => {
    const own = new Set(collectionsOf(plan))
    const projectHits = hits.filter((hit) => own.has(hit.collection))
    if (projectHits.length === 0) return []
    const found = await hydrateProjectHits(session, plan, projectHits, { forModel: true }).catch((error: unknown) => {
      throw new UpstreamError(
        'The hits could not be joined to their documents',
        error instanceof Error ? error.message : undefined
      )
    })
    return foundHitsOf(plan.project, found, request, reach, async () => plan.access)
  })
  return { found: perProject.flat(), searched }
}

function tagFiltersOf(request: CrossProjectSearchRequest): GroupedSearchFilters | undefined {
  if (request.documentTypes.length + request.disciplines.length === 0) return undefined
  return {
    ...(request.documentTypes.length ? { document_types: [...request.documentTypes] } : {}),
    ...(request.disciplines.length ? { disciplines: [...request.disciplines] } : {}),
  }
}

function byRelevance(a: FoundHit, b: FoundHit): number {
  if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank
  return b.hit.score - a.hit.score
}

async function decisionScopes(
  session: AuthorizedSession,
  projects: readonly Project[],
  reach: Pick<AudienceReach, 'restrictedFolders'>
): Promise<DecisionScope[]> {
  if (!reach.restrictedFolders) return projects.map((project) => ({ projectId: project.id, readableFolderIds: [] }))
  return mapBounded(projects, SEARCH_CONCURRENCY, async (project) => ({
    projectId: project.id,
    readableFolderIds: await readableFolderIdsFor(
      session.organizationId,
      project.id,
      await clearanceOf(session, project.id)
    ),
  }))
}

function asDecision(found: FoundDecision, byId: ReadonlyMap<string, Project>): CrossProjectDecision | null {
  const project = byId.get(found.projectId)
  if (!project) return null
  const origin = decisionOriginOf(found)
  return {
    project: projectRefOf(project),
    collection: project.collectionName,
    kind: found.kind === 'constraint' ? 'constraint' : 'decision',
    content: found.content,
    origin,
    confirmed: origin === 'person',
    evidence: found.evidence,
    recordedAt: found.updatedAt.toISOString(),
    restricted: found.restrictedFolderIds !== null,
  }
}

function asPermit(found: FoundPermitRecord, byId: ReadonlyMap<string, Project>): CrossProjectPermit | null {
  const project = byId.get(found.projectId)
  if (!project) return null
  return {
    project: projectRefOf(project),
    collection: found.collectionName,
    fileName: found.fileName,
    kind: found.kind,
    authority: found.authority,
    municipality: found.municipality,
    issuedOn: found.issuedOn,
    reference: found.reference,
    requirements: found.requirements,
    restricted: found.restrictedFolderIds !== null,
  }
}

export async function searchAcrossProjects(
  caller: CrossProjectCaller,
  request: CrossProjectSearchRequest
): Promise<CrossProjectSearchResponse> {
  const [audience, current] = await Promise.all([
    audienceReach(caller.session, caller.conversationId),
    request.scope === 'similar' || request.scope === 'closed' ? currentProjectOf(caller) : Promise.resolve(null),
  ])
  const reach = request.openFoldersOnly ? { ...audience, restrictedFolders: false } : audience
  const scope = projectsInScope(
    reach.projects,
    request,
    current ?? (caller.currentProjectId ? { id: caller.currentProjectId, profile: null } : null)
  )
  const candidates = scope.slice(request.offset, request.offset + CROSS_PROJECT_PAGE_PROJECTS)
  const { found: documents, searched } = await searchPage(caller.session, candidates, request, reach, current)
  const page = candidates.slice(0, searched)
  const memoryScopes = decisionScopes(caller.session, page, reach)
  const [decided, permitted] = await Promise.all([
    memoryScopes.then((scopes) => searchProjectDecisions(caller.session.organizationId, scopes, request.query)),
    memoryScopes.then(async (scopes) =>
      searchPermitRequirements(
        caller.session.organizationId,
        await mapBounded(scopes, SEARCH_CONCURRENCY, async (scope) => ({
          projectId: scope.projectId,
          access: await liveFolderAccess(caller.session.organizationId, scope.projectId, scope.readableFolderIds),
        })),
        request.query
      )
    ),
  ])
  const byId = new Map(page.map((project) => [project.id, project]))
  const decisions = decided.flatMap((found) => {
    const decision = asDecision(found, byId)
    return decision ? [{ decision, folderIds: found.restrictedFolderIds ?? [] }] : []
  })
  const permits = permitted.flatMap((found) => {
    const permit = asPermit(found, byId)
    return permit ? [{ permit, folderIds: found.restrictedFolderIds ?? [] }] : []
  })
  const kept = [...documents].sort(byRelevance).slice(0, request.limit)
  await recordCrossProjectHandOut(
    party(caller),
    {
      projectIds: [
        ...kept.map((found) => found.hit.project.id),
        ...decisions.map(({ decision }) => decision.project.id),
        ...permits.map(({ permit }) => permit.project.id),
      ],
      folderIds: [
        ...kept.map((found) => found.folderId).filter((folderId): folderId is string => folderId !== null),
        ...decisions.flatMap(({ folderIds }) => folderIds),
        ...permits.flatMap(({ folderIds }) => folderIds),
      ],
    },
    reach.key
  )
  const next = request.offset + page.length
  return {
    decisions: decisions.map(({ decision }) => decision),
    permits: permits.map(({ permit }) => permit),
    hits: kept.map((found) => found.hit),
    projectsInScope: scope.length,
    projectsSearched: page.length,
    nextOffset: next < scope.length ? next : null,
  }
}
