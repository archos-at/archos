/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@/lib/db/schema/projects'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  reachable: [] as Project[],
  outOfReach: [] as Project[],
  restrictedFolders: true,
  hits: new Map<string, Array<Record<string, unknown>>>(),
  siblingRows: new Map<string, Array<Record<string, unknown>>>(),
  failing: new Set<string>(),
  cleared: new Map<string, string[]>(),
  recorded: [] as Array<{ projectIds: readonly string[]; folderIds: readonly string[] }>,
  recordedFor: [] as string[],
  decisions: [] as Array<Record<string, unknown>>,
  decisionScopes: [] as Array<{ projectId: string; readableFolderIds: readonly string[] }>,
  permits: [] as Array<Record<string, unknown>>,
  permitScopes: [] as Array<{ projectId: string; readableFolderIds: readonly string[] }>,
  readable: new Map<string, string[]>(),
  folders: new Map<string, string>(),
  groupedFails: false,
  hydrateFails: new Set<string>(),
  ranking: null as string[] | null,
  groupedCalls: [] as Array<{
    collections: string[]
    filesPerCollection: number
    snippetMaxChars?: number
    options: { filters?: { document_types?: string[]; disciplines?: string[] }; boost?: unknown }
  }>,
  planned: [] as string[],
  hydrating: 0,
  hydratePeak: 0,
  hydrated: [] as Array<{ projectId: string; forModel?: boolean }>,
}))

vi.mock('./audience-reach', () => ({
  audienceReach: vi.fn(async () => ({ projects: state.reachable, restrictedFolders: state.restrictedFolders, key: 'audience-key' })),
}))
vi.mock('@/lib/conversations/cross-project-use', () => ({
  recordCrossProjectHandOut: vi.fn(
    async (_party: unknown, handOut: { projectIds: string[]; folderIds: string[] }, searchedFor: string) => {
      state.recorded.push(handOut)
      state.recordedFor.push(searchedFor)
    }
  ),
}))
vi.mock('@/lib/authz/folder-access', () => ({
  getProjectFolderAccess: vi.fn(async () => ({ sourceFolderOf: (collection: string) => state.folders.get(collection) ?? null })),
  clearanceOf: vi.fn(async () => ({ levels: { 'folder-gf': 'write' }, seesEverything: false })),
  readableFolderIdsFor: vi.fn(async (_org: string, projectId: string) => state.readable.get(projectId) ?? []),
}))
vi.mock('./decisions-repository', () => ({
  searchProjectDecisions: vi.fn(async (_org: string, scopes: Array<{ projectId: string; readableFolderIds: readonly string[] }>) => {
    state.decisionScopes.push(...scopes)
    return state.decisions
  }),
}))
vi.mock('@/lib/permits/live-access', () => ({
  liveFolderAccess: vi.fn(async (_org: string, _projectId: string, readableFolderIds: readonly string[]) => ({
    visibleFolderIds: null,
    restrictionOf: () => null,
    readableFolderIds,
  })),
}))

vi.mock('@/lib/permits/repository', () => ({
  searchPermitRequirements: vi.fn(async (_org: string, scopes: Array<{ projectId: string; access: { readableFolderIds: readonly string[] } }>) => {
    state.permitScopes.push(...scopes.map((scope) => ({ projectId: scope.projectId, readableFolderIds: scope.access.readableFolderIds })))
    return state.permits
  }),
}))
vi.mock('@/lib/projects/repository', () => ({
  findProjectInOrg: vi.fn(
    async (id: string) => [...state.reachable, ...state.outOfReach].find((project) => project.id === id) ?? null
  ),
}))
vi.mock('@/lib/documents/semantic-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/documents/semantic-search')>()
  const projectOf = (projectId: string) => [...state.reachable, ...state.outOfReach].find((one) => one.id === projectId)
  const rowsOf = (projectId: string) =>
    [
      ...(state.hits.get(projectId) ?? []).map(({ snippet: _snippet, page: _page, score: _score, ...row }) => ({
        authoredBy: 'user',
        ...row,
      })),
      ...(state.siblingRows.get(projectId) ?? []),
    ] as unknown as Array<{ filename: string; collectionName: string; createdAt: Date; authoredBy: string }>
  return {
    BACKEND_SEARCH_MAX_COLLECTIONS: actual.BACKEND_SEARCH_MAX_COLLECTIONS,
    projectsWithinCollectionCap: actual.projectsWithinCollectionCap,
    planProjectSearch: vi.fn(async (_session: unknown, projectId: string) => {
      state.planned.push(projectId)
      if (state.failing.has(projectId)) throw new Error('access withdrawn')
      const found = projectOf(projectId)
      if (!found) throw new Error('not found')
      const restricted = [
        ...new Set(
          (state.hits.get(projectId) ?? [])
            .map((row) => row.collectionName as string)
            .filter((collection) => collection !== found.collectionName)
        ),
      ]
      return {
        project: found,
        access: { sourceFolderOf: (collection: string) => state.folders.get(collection) ?? null, hiddenFolderIds: new Set() },
        collections: [found.collectionName, ...restricted, ...(state.cleared.get(projectId) ?? [])],
      }
    }),
    fetchGroupedSemanticHits: vi.fn(
      async (
        _organizationId: string,
        collections: readonly string[],
        _query: string,
        filesPerCollection: number,
        snippetMaxChars?: number,
        options: { filters?: { document_types?: string[]; disciplines?: string[] }; boost?: unknown } = {}
      ) => {
        if (state.groupedFails) throw new UpstreamError('Grouped search backend returned 500')
        state.groupedCalls.push({ collections: [...collections], filesPerCollection, snippetMaxChars, options })
        const asked = new Set(collections)
        const anyOf = (tags: string[], wanted?: string[]) => !wanted?.length || wanted.some((tag) => tags.includes(tag))
        const chunkTags = (row: Record<string, unknown>) => (row.chunkTags ?? row.tags ?? []) as string[]
        const all = [...state.hits.values()]
          .flat()
          .filter((row) => asked.has(row.collectionName as string))
          .filter((row) => anyOf(chunkTags(row), options.filters?.document_types) && anyOf(chunkTags(row), options.filters?.disciplines))
        const order = state.ranking
        const fused = order
          ? (row: Record<string, unknown>) => -order.indexOf(row.id as string)
          : (row: Record<string, unknown>) => row.score as number
        const perCollection = new Map<string, Array<Record<string, unknown>>>()
        for (const row of [...all].sort((a, b) => fused(b) - fused(a))) {
          const kept = perCollection.get(row.collectionName as string) ?? []
          if (kept.length < filesPerCollection) kept.push(row)
          perCollection.set(row.collectionName as string, kept)
        }
        return [...perCollection.values()]
          .flat()
          .sort((a, b) => fused(b) - fused(a))
          .map((row, rank) => ({
            file_name: row.filename as string,
            collection: row.collectionName as string,
            score: row.score as number,
            snippet: row.snippet as string,
            page_number: row.page as number | null,
            rank,
          }))
      }
    ),
    hydrateProjectHits: vi.fn(
      async (
        _session: unknown,
        plan: { project: Project; collections: string[] },
        hits: Array<{ collection: string; file_name: string; score: number; snippet: string; page_number: number | null; rank?: number }>,
        options: { forModel?: boolean }
      ) => {
        if (state.hydrateFails.has(plan.project.id)) throw new Error('connection terminated')
        state.hydrated.push({ projectId: plan.project.id, forModel: options.forModel })
        state.hydrating += 1
        state.hydratePeak = Math.max(state.hydratePeak, state.hydrating)
        await Promise.resolve()
        state.hydrating -= 1
        return actual.joinHitsToFiles(
          hits.filter((one) => plan.collections.includes(one.collection)),
          rowsOf(plan.project.id)
        )
      }
    ),
  }
})

import { UpstreamError } from '@/lib/api/errors'
import { holdsFacts, listLookupProjects, periodOverlaps, searchAcrossProjects } from './service'
import { crossProjectListRequestSchema } from './types'
import { projectFactsOf } from './project-facts-mirror'
import { OWNER, caller, hit, project, search } from './service.fixtures'

beforeEach(() => {
  vi.clearAllMocks()
  state.reachable = [project(1), project(2), project(3)]
  state.outOfReach = [project(9)]
  state.restrictedFolders = true
  state.hits = new Map()
  state.siblingRows = new Map()
  state.failing = new Set()
  state.cleared = new Map()
  state.hydrated = []
  state.recorded = []
  state.recordedFor = []
  state.decisions = []
  state.decisionScopes = []
  state.permits = []
  state.permitScopes = []
  state.readable = new Map()
  state.folders = new Map()
  state.groupedFails = false
  state.hydrateFails = new Set()
  state.ranking = null
  state.groupedCalls = []
  state.planned = []
  state.hydrating = 0
  state.hydratePeak = 0
})

describe('periodOverlaps', () => {
  it('is inclusive at both ends, treats an open end as running on, and is open when a bound is missing', () => {
    expect(periodOverlaps({ start: '2020-01-01', end: '2021-06-30' }, '2021-06-30', '2022-01-01')).toBe(true)
    expect(periodOverlaps({ start: '2020-01-01', end: '2021-06-30' }, '2021-07-01')).toBe(false)
    expect(periodOverlaps({ start: '2026-05-01', end: null }, undefined, '2026-04-30')).toBe(false)
    expect(periodOverlaps({ start: '2020-01-01', end: null }, '2030-01-01')).toBe(true)
  })
})

describe('the project facts a lookup narrows by', () => {
  type Facts = Record<string, unknown>
  const closed = { status: 'closed' as const, closedAt: new Date(), closedBy: OWNER }
  const profileOf = (facts: Facts, suggested: Facts = {}): Project['profile'] => ({
    facts: Object.fromEntries(
      Object.entries(facts).map(([key, value]) => [
        key,
        { value: value as string, confidence: 'confirmed' as const, source: 'onboarding' as const, updatedAt: '' },
      ])
    ),
    goals: {},
    unknowns: [],
    assumptions: Object.fromEntries(
      Object.entries(suggested).map(([key, value]) => [
        key,
        {
          value: value as string,
          status: 'unconfirmed' as const,
          reason: 'Aus den Unterlagen',
          source: 'agent_suggested' as const,
          updatedAt: '',
        },
      ])
    ),
  })
  const TIROL_GK4_WOHNEN = { projectFacts: { federal_state: ['tyrol'], building_class: [4], uses: ['residential'] } }

  function office(): Project[] {
    return [
      project(1, { ...closed, profile: profileOf({ federal_state: 'tyrol', building_class: 4, uses: ['residential', 'office'] }) }),
      project(2, { profile: profileOf({ federal_state: 'tyrol', building_class: 3, uses: ['residential'] }) }),
      project(3, { ...closed, profile: profileOf({ federal_state: 'tyrol', uses: ['residential'] }, { building_class: 'GK 4' }) }),
      project(4, { profile: profileOf({ federal_state: 'vienna', building_class: 4, uses: ['residential'] }) }),
      project(5, { profile: profileOf({ federal_state: 'tyrol', uses: ['residential'] }) }),
    ]
  }

  it('searches only the projects whose profile holds every asked fact, and counts and pages the narrowed set', async () => {
    state.reachable = office()
    const [one, , three, wien] = state.reachable
    state.hits.set(one.id, [hit('a', 0.9)])
    state.hits.set(wien.id, [hit('vienna', 0.95, { collectionName: 'proj_4' })])

    const result = await searchAcrossProjects(caller(), search({ scope: 'all', ...TIROL_GK4_WOHNEN }))

    expect(state.planned).toEqual([one.id, three.id])
    expect(state.groupedCalls[0].collections).toEqual(['proj_1', 'proj_3'])
    expect(result).toMatchObject({ projectsInScope: 2, projectsSearched: 2, nextOffset: null })
    expect(result.hits.map((found) => found.filename)).toEqual(['a.pdf'])
    expect(state.decisionScopes.map((scope) => scope.projectId)).toEqual([one.id, three.id])
    expect(state.permitScopes.map((scope) => scope.projectId)).toEqual([one.id, three.id])
  })

  it('selects exactly the projects whose mirrored copy the grouped search’s own fact filter would match', async () => {
    state.reachable = office()
    const wanted = TIROL_GK4_WOHNEN.projectFacts
    const mirrorMatches = (copy: ReturnType<typeof projectFactsOf>) =>
      wanted.federal_state.includes(copy.federal_state ?? '') &&
      wanted.building_class.some((gk) => copy.building_class.includes(gk)) &&
      wanted.uses.some((use) => copy.uses.includes(use))

    await searchAcrossProjects(caller(), search({ scope: 'all', ...TIROL_GK4_WOHNEN }))

    const expected = state.reachable.filter((one) => mirrorMatches(projectFactsOf(one.profile))).map((one) => one.id)
    expect(expected).toHaveLength(2)
    expect(state.planned).toEqual(expected)
  })

  it('does not send the filter to the grouped search: the page already carries it, and the copy may lag', async () => {
    state.reachable = office()

    await searchAcrossProjects(caller(), search({ ...TIROL_GK4_WOHNEN, documentTypes: ['Detail'] }))

    expect(state.groupedCalls[0].options.filters).toEqual({ document_types: ['Detail'] })
  })

  it('narrows the likeness scopes and keeps their order and the search’s likeness lift', async () => {
    const current = project(7, { profile: profileOf({ federal_state: 'tyrol', building_class: 4, construction_method: ['timber'] }) })
    state.outOfReach = [current]
    state.reachable = [
      project(1, { ...closed, profile: profileOf({ federal_state: 'tyrol', building_class: 2, uses: ['residential'] }) }),
      project(2, {
        ...closed,
        profile: profileOf({ federal_state: 'tyrol', building_class: 4, construction_method: ['timber'], uses: ['residential'] }),
      }),
      project(3, {
        ...closed,
        profile: profileOf({ federal_state: 'vienna', building_class: 4, construction_method: ['timber'], uses: ['residential'] }),
      }),
    ]
    const [low, high] = state.reachable

    await searchAcrossProjects(caller(current.id), search({ scope: 'similar', projectFacts: { federal_state: ['tyrol'] } }))

    expect(state.planned).toEqual([high.id, low.id])
    expect(state.groupedCalls[0].options.boost).toMatchObject({ facts: { federal_state: 'tyrol', building_class: [4] } })
  })

  it('narrows a named scope too: a named project without the facts is not searched', async () => {
    state.reachable = office()
    const [one, two] = state.reachable

    const result = await searchAcrossProjects(
      caller(),
      search({ scope: 'named', projectIds: [one.id, two.id], ...TIROL_GK4_WOHNEN })
    )

    expect(state.planned).toEqual([one.id])
    expect(result.projectsInScope).toBe(1)
  })

  it('never widens the audience: a matching project out of reach stays invisible, a shared chat searches no restricted folder', async () => {
    const stranger = project(9, { ...closed, profile: profileOf({ federal_state: 'tyrol', building_class: 4, uses: ['residential'] }) })
    state.outOfReach = [stranger]
    state.reachable = office()
    state.restrictedFolders = false
    const [one] = state.reachable
    state.folders.set('proj_1_rabcdef012345', 'folder-honorare')
    state.hits.set(one.id, [hit('honorar', 0.9, { collectionName: 'proj_1_rabcdef012345' }), hit('plan', 0.7)])

    const result = await searchAcrossProjects(
      caller(),
      search({ scope: 'named', projectIds: [stranger.id, one.id], ...TIROL_GK4_WOHNEN })
    )

    expect(state.planned).toEqual([one.id])
    expect(state.groupedCalls[0].collections).toEqual(['proj_1'])
    expect(result.hits.map((found) => found.filename)).toEqual(['plan.pdf'])
    expect(state.recorded).toEqual([{ projectIds: [one.id], folderIds: [] }])
  })

  it('lists only the projects with the facts, and records only those', async () => {
    state.reachable = office()
    const [one, , three] = state.reachable

    const result = await listLookupProjects(caller(), crossProjectListRequestSchema.parse(TIROL_GK4_WOHNEN))

    expect(result.projects.map((found) => found.id)).toEqual([one.id, three.id])
    expect(result.total).toBe(2)
    expect(state.recorded).toEqual([{ projectIds: [one.id, three.id], folderIds: [] }])
  })
})

describe('holdsFacts', () => {
  const profileWith = (facts: Record<string, unknown>): Project['profile'] => ({
    facts: Object.fromEntries(
      Object.entries(facts).map(([key, value]) => [
        key,
        { value: value as string, confidence: 'confirmed' as const, source: 'onboarding' as const, updatedAt: '' },
      ])
    ),
    goals: {},
    unknowns: [],
    assumptions: {},
  })

  it('is any of within a fact, all of across facts, and holds for every project without a filter', () => {
    const hybrid = profileWith({ federal_state: 'Niederösterreich', construction_method: ['timber', 'reinforced_concrete'], work_type: ['new_build'] })

    expect(holdsFacts(hybrid, undefined)).toBe(true)
    expect(holdsFacts(hybrid, {})).toBe(true)
    expect(holdsFacts(hybrid, { construction_method: ['steel', 'timber'] })).toBe(true)
    expect(holdsFacts(hybrid, { federal_state: ['lower_austria'], work_type: ['new_build'] })).toBe(true)
    expect(holdsFacts(hybrid, { federal_state: ['lower_austria'], work_type: ['conversion'] })).toBe(false)
    expect(holdsFacts(null, { construction_method: ['timber'] })).toBe(false)
  })

  it('reads a site abroad and „noch offen" as no value, so neither matches', () => {
    expect(holdsFacts(profileWith({ federal_state: 'outside_austria' }), { federal_state: ['vienna'] })).toBe(false)
    expect(holdsFacts(profileWith({ construction_method: ['open'] }), { construction_method: ['timber'] })).toBe(false)
  })
})
