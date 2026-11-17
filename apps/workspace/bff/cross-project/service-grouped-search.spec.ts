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
import { CROSS_PROJECT_SNIPPET_CHARS, SEARCH_CONCURRENCY, searchAcrossProjects } from './service'
import { CROSS_PROJECT_PAGE_PROJECTS } from './types'
import { SIMILARITY_WEIGHTS } from './similarity'
import { BACKEND_SEARCH_MAX_COLLECTIONS } from '@/lib/documents/semantic-search'
import { caller, hit, project, search } from './service.fixtures'

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

describe('searchAcrossProjects in one grouped query (ADR-0116)', () => {
  it('searches the whole page in ONE call and keeps its ranking, not the scores', async () => {
    const [one, two] = state.reachable
    state.hits.set(one.id, [hit('a', 0.9)])
    state.hits.set(two.id, [hit('b', 0.4, { collectionName: 'proj_2' })])
    state.ranking = ['b', 'a']

    const result = await searchAcrossProjects(caller(), search({}))

    expect(state.groupedCalls).toHaveLength(1)
    expect(state.groupedCalls[0].collections).toEqual(['proj_1', 'proj_2', 'proj_3'])
    expect(result.hits.map((found) => found.filename)).toEqual(['b.pdf', 'a.pdf'])
  })

  it('keeps one project’s weak documents from crowding out another project’s strong one', async () => {
    const [one, two, three] = state.reachable
    state.hits.set(one.id, [hit('stark', 0.95), ...Array.from({ length: 12 }, (_, n) => hit(`schwach${n}`, 0.6))])
    state.hits.set(two.id, [hit('zwei', 0.85, { collectionName: 'proj_2' })])
    state.hits.set(three.id, [hit('drei', 0.84, { collectionName: 'proj_3' })])

    const result = await searchAcrossProjects(caller(), search({ limit: 3 }))

    expect(result.hits.map((found) => found.filename)).toEqual(['stark.pdf', 'zwei.pdf', 'drei.pdf'])
  })

  it('covers a wide page per call, since a project no longer costs a search', async () => {
    state.reachable = Array.from({ length: CROSS_PROJECT_PAGE_PROJECTS + 5 }, (_, index) => project(index + 1))

    const first = await searchAcrossProjects(caller(), search({}))

    expect(first).toMatchObject({
      projectsSearched: CROSS_PROJECT_PAGE_PROJECTS,
      nextOffset: CROSS_PROJECT_PAGE_PROJECTS,
    })
    expect(state.decisionScopes).toHaveLength(CROSS_PROJECT_PAGE_PROJECTS)
  })

  it('joins a wide page’s hits to their rows a bounded number of projects at a time', async () => {
    state.reachable = Array.from({ length: CROSS_PROJECT_PAGE_PROJECTS }, (_, index) => project(index + 1))
    for (const one of state.reachable) state.hits.set(one.id, [hit(`h${one.collectionName}`, 0.5, { collectionName: one.collectionName })])

    await searchAcrossProjects(caller(), search({ limit: 20 }))

    expect(state.hydratePeak).toBeGreaterThan(0)
    expect(state.hydratePeak).toBeLessThanOrEqual(SEARCH_CONCURRENCY)
  })

  it('stops adding projects before the collections pass the backend’s cap, and pages the rest', async () => {
    state.reachable = Array.from({ length: CROSS_PROJECT_PAGE_PROJECTS }, (_, index) => project(index + 1))
    for (const one of state.reachable) {
      state.cleared.set(one.id, Array.from({ length: 19 }, (_, n) => `${one.collectionName}_r${String(n).padStart(12, '0')}`))
    }
    const fitting = Math.floor(BACKEND_SEARCH_MAX_COLLECTIONS / 20)

    const first = await searchAcrossProjects(caller(), search({}))

    expect(BACKEND_SEARCH_MAX_COLLECTIONS).toBe(500)
    expect(state.groupedCalls[0].collections).toHaveLength(fitting * 20)
    expect(first).toMatchObject({ projectsSearched: fitting, nextOffset: fitting, projectsInScope: CROSS_PROJECT_PAGE_PROJECTS })
    expect(state.decisionScopes.map((scope) => scope.projectId)).toEqual(state.reachable.slice(0, fitting).map((one) => one.id))

    state.groupedCalls = []
    const second = await searchAcrossProjects(caller(), search({ offset: first.nextOffset }))
    expect(state.groupedCalls[0].collections).toHaveLength((CROSS_PROJECT_PAGE_PROJECTS - fitting) * 20)
    expect(second).toMatchObject({ projectsSearched: CROSS_PROJECT_PAGE_PROJECTS - fitting, nextOffset: null })
  })

  it('searches a project cleared for more folders than the cap allows alone, cut to the cap, so a page never stalls', async () => {
    const [one, two] = state.reachable
    state.cleared.set(one.id, Array.from({ length: BACKEND_SEARCH_MAX_COLLECTIONS + 10 }, (_, n) => `proj_1_r${String(n).padStart(12, '0')}`))

    const result = await searchAcrossProjects(caller(), search({}))

    expect(state.groupedCalls[0].collections).toHaveLength(BACKEND_SEARCH_MAX_COLLECTIONS)
    expect(state.groupedCalls[0].collections[0]).toBe('proj_1')
    expect(state.groupedCalls[0].collections).not.toContain(two.collectionName)
    expect(result).toMatchObject({ projectsSearched: 1, nextOffset: 1 })
  })

  it('does not even search a restricted folder from a shared chat', async () => {
    const [one] = state.reachable
    state.restrictedFolders = false
    state.folders.set('proj_1_rabcdef012345', 'folder-honorare')
    state.hits.set(one.id, [hit('honorar', 0.9, { collectionName: 'proj_1_rabcdef012345' }), hit('plan', 0.7)])

    const result = await searchAcrossProjects(caller(), search({}))

    expect(state.groupedCalls[0].collections).not.toContain('proj_1_rabcdef012345')
    expect(result.hits.map((found) => found.filename)).toEqual(['plan.pdf'])
  })

  it('records the restricted folder a passage came from, and drops one whose folder cannot be named', async () => {
    const [one] = state.reachable
    state.folders.set('proj_1_rabcdef012345', 'folder-honorare')
    state.hits.set(one.id, [
      hit('honorar', 0.9, { collectionName: 'proj_1_rabcdef012345' }),
      hit('unnamed', 0.8, { collectionName: 'proj_1_r999999999999' }),
      hit('plan', 0.7),
    ])

    const result = await searchAcrossProjects(caller(), search({}))

    expect(result.hits.map((found) => found.filename)).toEqual(['honorar.pdf', 'plan.pdf'])
    expect(state.recorded).toEqual([{ projectIds: [one.id, one.id], folderIds: ['folder-honorare'] }])
  })

  it('leaves out a project whose access went between listing and search, and keeps the others', async () => {
    const [one, two] = state.reachable
    state.hits.set(one.id, [hit('a', 0.9)])
    state.hits.set(two.id, [hit('b', 0.8, { collectionName: 'proj_2' })])
    state.failing.add(one.id)

    const result = await searchAcrossProjects(caller(), search({}))

    expect(state.groupedCalls[0].collections).not.toContain('proj_1')
    expect(result.hits.map((found) => found.filename)).toEqual(['b.pdf'])
  })

  it('reports a page no project of which could be authorized as an upstream error, not as searched and empty', async () => {
    for (const one of state.reachable) state.failing.add(one.id)

    await expect(searchAcrossProjects(caller(), search({}))).rejects.toBeInstanceOf(UpstreamError)
    expect(state.groupedCalls).toEqual([])
    expect(state.recorded).toEqual([])
  })

  it('surfaces a failed search as an upstream error, never as "nothing found", and records nothing', async () => {
    state.hits.set(state.reachable[0].id, [hit('a', 0.9)])
    state.groupedFails = true

    await expect(searchAcrossProjects(caller(), search({}))).rejects.toBeInstanceOf(UpstreamError)
    expect(state.recorded).toEqual([])
  })

  it('surfaces hits it cannot join to their documents as an upstream error, not as "nothing found", and records nothing', async () => {
    const [one, two] = state.reachable
    state.hits.set(one.id, [hit('a', 0.9)])
    state.hits.set(two.id, [hit('b', 0.8, { collectionName: 'proj_2' })])
    state.hydrateFails.add(two.id)

    await expect(searchAcrossProjects(caller(), search({}))).rejects.toBeInstanceOf(UpstreamError)
    expect(state.recorded).toEqual([])
  })

  it('filters by type and discipline INSIDE the search and asks each project for the limit, not three times it', async () => {
    const [one] = state.reachable
    state.hits.set(one.id, [hit('a', 0.9, { tags: ['Detail'] }), hit('b', 0.8, { tags: ['Bescheid'] })])

    const result = await searchAcrossProjects(caller(), search({ documentTypes: ['Bescheid'], disciplines: ['Brandschutz'], limit: 5 }))

    expect(state.groupedCalls[0]).toMatchObject({
      filesPerCollection: 5,
      snippetMaxChars: CROSS_PROJECT_SNIPPET_CHARS,
      options: { filters: { document_types: ['Bescheid'], disciplines: ['Brandschutz'] } },
    })
    expect(result.hits).toEqual([])
  })

  it('still drops a hit whose document row no longer carries the tag: the search’s copy may lag', async () => {
    const [one] = state.reachable
    state.hits.set(one.id, [hit('a', 0.9, { tags: ['Detail'], chunkTags: ['Bescheid'] }), hit('b', 0.8, { tags: ['Bescheid'] })])

    const result = await searchAcrossProjects(caller(), search({ documentTypes: ['Bescheid'] }))

    expect(result.hits.map((found) => found.filename)).toEqual(['b.pdf'])
  })

  it('lifts projects like the current one by its fingerprint and the one set of similarity weights', async () => {
    const current = project(7, {
      profile: {
        facts: { federal_state: { value: 'vienna', source: 'user_confirmed' }, construction_method: { value: ['timber'], source: 'user_confirmed' } },
        goals: {},
        unknowns: [],
        assumptions: {},
      } as unknown as Project['profile'],
    })
    state.outOfReach = [current]

    await searchAcrossProjects(caller(current.id), search({}))
    await searchAcrossProjects(caller(current.id), search({ scope: 'all' }))

    expect(state.groupedCalls[0].options.boost).toEqual({
      facts: { federal_state: 'vienna', building_class: [], construction_method: ['timber'], uses: [], work_type: [] },
      weights: {
        federal_state: SIMILARITY_WEIGHTS.federalState,
        building_class: SIMILARITY_WEIGHTS.buildingClass,
        building_class_adjacent: SIMILARITY_WEIGHTS.buildingClassAdjacent,
        construction_method: SIMILARITY_WEIGHTS.constructionMethod,
        use: SIMILARITY_WEIGHTS.use,
        use_max: SIMILARITY_WEIGHTS.useMax,
        work_type: SIMILARITY_WEIGHTS.workType,
      },
    })
    expect(state.groupedCalls[1].options.boost).toBeNull()
  })
})
