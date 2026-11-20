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

import { CrossProjectAudienceChangedError, UpstreamError } from '@/lib/api/errors'
import { CROSS_PROJECT_SNIPPET_CHARS, searchAcrossProjects } from './service'
import { CROSS_PROJECT_PAGE_PROJECTS } from './types'
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

describe('searchAcrossProjects', () => {
  it('searches only the projects in reach, never its own, and names each hit’s project and status', async () => {
    state.reachable = [project(1), project(2), project(3, { status: 'closed', closedAt: new Date(), closedBy: OWNER })]
    const [one, two, three] = state.reachable
    state.hits.set(one.id, [hit('a', 0.5)])
    state.hits.set(three.id, [hit('c', 0.9, { displayName: 'Dachdetail Traufe', collectionName: 'proj_3' })])

    const result = await searchAcrossProjects(caller(two.id), search({}))

    expect(state.planned).toEqual([one.id, three.id])
    expect(result.hits.map((found) => [found.project.name, found.project.status, found.filename])).toEqual([
      ['Projekt 3', 'closed', 'c.pdf'],
      ['Projekt 1', 'active', 'a.pdf'],
    ])
    expect(result.hits[0]).toMatchObject({ title: 'Dachdetail Traufe', collection: 'proj_3', page: 2 })
    expect(result).toMatchObject({ projectsInScope: 2, projectsSearched: 2, nextOffset: null })
  })

  it('records the projects of the hits it hands out, and only those, before it answers', async () => {
    const [one, , three] = state.reachable
    state.hits.set(one.id, [hit('a', 0.5)])

    await searchAcrossProjects(caller(), search({}))

    expect(state.recorded).toEqual([{ projectIds: [one.id], folderIds: [] }])
    expect(state.recorded[0].projectIds).not.toContain(three.id)
    expect(state.recordedFor).toEqual(['audience-key'])
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

  it('searches no restricted folder from a shared chat: only the project’s open collection reaches it', async () => {
    const [one] = state.reachable
    state.restrictedFolders = false
    state.folders.set('proj_1_rabcdef012345', 'folder-honorare')
    state.hits.set(one.id, [hit('honorar', 0.9, { collectionName: 'proj_1_rabcdef012345' }), hit('plan', 0.7)])

    const result = await searchAcrossProjects(caller(), search({}))

    expect(result.hits.map((found) => found.filename)).toEqual(['plan.pdf'])
    expect(state.recorded).toEqual([{ projectIds: [one.id], folderIds: [] }])
  })

  describe('a restricted passage and a newer same-named open document', () => {
    const GF_COLLECTION = 'proj_1_rabcdef012345'
    const newerOpenRow = () => ({
      id: 'protokoll-root',
      authoredBy: 'user',
      filename: 'protokoll.pdf',
      displayName: null,
      collectionName: 'proj_1',
      createdAt: new Date('2026-09-01T08:00:00Z'),
      tags: [],
    })

    function arrange() {
      const [one] = state.reachable
      state.folders.set(GF_COLLECTION, 'folder-gf')
      state.hits.set(one.id, [hit('protokoll', 0.9, { collectionName: GF_COLLECTION, snippet: 'Honorar GF intern' })])
      state.siblingRows.set(one.id, [newerOpenRow()])
      return one
    }

    it('keeps the passage out of a shared chat instead of passing it off as the open document', async () => {
      arrange()
      state.restrictedFolders = false

      const result = await searchAcrossProjects(caller(), search({}))

      expect(result.hits).toEqual([])
      expect(state.recorded.flatMap((handOut) => [...handOut.projectIds, ...handOut.folderIds])).toEqual([])
    })

    it('returns it from a solo chat as the restricted document, recorded with its folder', async () => {
      const one = arrange()

      const result = await searchAcrossProjects(caller(), search({}))

      expect(result.hits).toHaveLength(1)
      expect(result.hits[0]).toMatchObject({ documentId: 'protokoll', collection: GF_COLLECTION, snippet: 'Honorar GF intern' })
      expect(result.hits[0].documentId).not.toBe('protokoll-root')
      expect(state.recorded).toEqual([{ projectIds: [one.id], folderIds: ['folder-gf'] }])
    })
  })

  describe('openFoldersOnly in a solo chat', () => {
    const FOLDER_COLLECTION = 'proj_1_rabcdef012345'

    function arrange() {
      const [one] = state.reachable
      state.folders.set(FOLDER_COLLECTION, 'folder-honorare')
      state.readable.set(one.id, ['folder-honorare'])
      state.hits.set(one.id, [hit('honorar', 0.9, { collectionName: FOLDER_COLLECTION }), hit('plan', 0.7)])
      return one
    }

    it('returns and records no restricted passage, and asks decisions and permits with no readable folder', async () => {
      const one = arrange()

      const result = await searchAcrossProjects(caller(), search({ openFoldersOnly: true }))

      expect(result.hits.map((found) => found.filename)).toEqual(['plan.pdf'])
      expect(state.decisionScopes.length).toBeGreaterThan(0)
      expect(state.decisionScopes.every((scope) => scope.readableFolderIds.length === 0)).toBe(true)
      expect(state.permitScopes).toEqual(state.decisionScopes)
      expect(state.recorded).toEqual([{ projectIds: [one.id], folderIds: [] }])
    })

    it('still gives the solo chat its restricted passages, decisions and permits without it', async () => {
      const one = arrange()

      const result = await searchAcrossProjects(caller(), search({}))

      expect(result.hits.map((found) => found.filename)).toEqual(['honorar.pdf', 'plan.pdf'])
      expect(state.decisionScopes.find((scope) => scope.projectId === one.id)?.readableFolderIds).toEqual(['folder-honorare'])
      expect(state.permitScopes).toEqual(state.decisionScopes)
      expect(state.recorded.map((handOut) => [...new Set(handOut.projectIds)])).toEqual([[one.id]])
      expect(state.recorded.flatMap((handOut) => handOut.folderIds)).toEqual(['folder-honorare'])
    })
  })

  it('returns nothing when the record refuses: the audience changed while the search ran', async () => {
    const { recordCrossProjectHandOut } = await import('@/lib/conversations/cross-project-use')
    vi.mocked(recordCrossProjectHandOut).mockRejectedValueOnce(new CrossProjectAudienceChangedError('geändert'))
    state.hits.set(state.reachable[0].id, [hit('a', 0.5)])

    await expect(searchAcrossProjects(caller(), search({}))).rejects.toBeInstanceOf(CrossProjectAudienceChangedError)
  })

  it('walks the projects most like the current one first by default', async () => {
    const facts = (federalState: string, gk: number) => ({
      facts: {
        federal_state: { value: federalState, confidence: 'confirmed' as const, source: 'onboarding' as const, updatedAt: '' },
        building_class: { value: gk, confidence: 'confirmed' as const, source: 'onboarding' as const, updatedAt: '' },
      },
      goals: {},
      unknowns: [],
      assumptions: {},
    })
    state.reachable = [
      project(1, { profile: facts('vienna', 2) }),
      project(2, { profile: facts('lower_austria', 4) }),
      project(3, { profile: facts('lower_austria', 4) }),
    ]

    await searchAcrossProjects(caller(state.reachable[2].id), search({}))

    expect(state.planned).toEqual([state.reachable[1].id, state.reachable[0].id])
  })

  it('says each hit’s Bundesland, so the agent can tell a precedent decided under another Bauordnung', async () => {
    state.reachable = [
      project(1, {
        profile: {
          facts: { federal_state: { value: 'styria', confidence: 'confirmed', source: 'onboarding', updatedAt: '' } },
          goals: {},
          unknowns: [],
          assumptions: {},
        },
      }),
    ]
    state.hits.set(state.reachable[0].id, [hit('a', 0.5)])

    const result = await searchAcrossProjects(caller(), search({}))

    expect(result.hits[0].project.federal_state).toBe('styria')
  })

  it('says a project abroad as ausserhalb_oesterreichs, so the agent can label it outside Austria', async () => {
    state.reachable = [
      project(1, {
        profile: {
          facts: {
            federal_state: { value: 'outside_austria', confidence: 'confirmed', source: 'onboarding', updatedAt: '' },
          },
          goals: {},
          unknowns: [],
          assumptions: {},
        },
      }),
    ]
    state.hits.set(state.reachable[0].id, [hit('a', 0.5)])

    const result = await searchAcrossProjects(caller(), search({}))

    expect(result.hits[0].project.federal_state).toBe('outside_austria')
  })

  it('makes a project out of chat reach invisible, even when named', async () => {
    const stranger = project(9)

    const result = await searchAcrossProjects(
      caller(),
      search({ scope: 'named', projectIds: [stranger.id, state.reachable[0].id] })
    )

    expect(state.planned).toEqual([state.reachable[0].id])
    expect(result.projectsInScope).toBe(1)
  })

  it('asks for the longer passage the agent answers from, and joins it as a model reads it', async () => {
    const [one, two] = state.reachable
    state.hits.set(one.id, [hit('a', 0.9)])
    state.hits.set(two.id, [hit('b', 0.8, { collectionName: 'proj_2' })])

    await searchAcrossProjects(caller(), search({}))

    expect(state.groupedCalls[0].snippetMaxChars).toBe(CROSS_PROJECT_SNIPPET_CHARS)
    expect(state.hydrated.map((call) => call.projectId)).toEqual([one.id, two.id])
    expect(state.hydrated.every((call) => call.forModel)).toBe(true)
  })

  it('searches one bounded page of projects and says where the next starts', async () => {
    state.reachable = Array.from({ length: CROSS_PROJECT_PAGE_PROJECTS + 3 }, (_, index) => project(index + 1))

    const first = await searchAcrossProjects(caller(), search({}))
    expect(first).toMatchObject({ projectsSearched: CROSS_PROJECT_PAGE_PROJECTS, nextOffset: CROSS_PROJECT_PAGE_PROJECTS })

    state.planned = []
    const second = await searchAcrossProjects(caller(), search({ offset: first.nextOffset }))
    expect(second).toMatchObject({ projectsSearched: 3, nextOffset: null })
    expect(state.planned).toHaveLength(3)
  })

  it('searches only the closed projects in the closed scope', async () => {
    state.reachable = [project(1), project(2, { status: 'closed', closedAt: new Date(), closedBy: OWNER })]

    const result = await searchAcrossProjects(caller(), search({ scope: 'closed' }))

    expect(result).toMatchObject({ projectsInScope: 1 })
    expect(state.planned).toEqual([state.reachable[1].id])
  })

  it('walks the closed projects most like the current one first, as the catalog lists them', async () => {
    const closed = { status: 'closed' as const, closedAt: new Date(), closedBy: OWNER }
    const profile = (federalState: string) => ({
      facts: { federal_state: { value: federalState, confidence: 'confirmed' as const, source: 'onboarding' as const, updatedAt: '' } },
      goals: {},
      unknowns: [],
      assumptions: {},
    })
    state.reachable = [
      project(1, { ...closed, profile: profile('vienna') }),
      project(2, { ...closed, profile: profile('tyrol') }),
      project(3, { profile: profile('tyrol') }),
    ]

    await searchAcrossProjects(caller(state.reachable[2].id), search({ scope: 'closed' }))

    expect(state.planned).toEqual([state.reachable[1].id, state.reachable[0].id])
  })

  it('walks the projects the turn’s reference fit names first, and only reorders the scope', async () => {
    const closed = { status: 'closed' as const, closedAt: new Date(), closedBy: OWNER }
    state.reachable = [project(1, closed), project(2, closed), project(3, closed), project(4)]
    const [first, second, third, running] = state.reachable

    await searchAcrossProjects(
      caller(),
      search({ scope: 'closed', order: [third.id, running.id, '99999999-0000-4000-8000-000000000099'] })
    )

    expect(state.planned).toEqual([third.id, first.id, second.id])
  })

  it('narrows by the PROJECT’s period before searching, not by when a file was uploaded', async () => {
    const result = await searchAcrossProjects(caller(), search({ to: '2026-03-31' }))

    expect(state.planned).toEqual([state.reachable[0].id, state.reachable[1].id])
    expect(result.projectsInScope).toBe(2)

    state.reachable = [project(1, { startedOn: '2015-03-01', endedOn: '2017-06-01' }), project(2)]
    state.planned = []
    await searchAcrossProjects(caller(), search({ from: '2015-01-01', to: '2018-01-01' }))
    expect(state.planned).toEqual([state.reachable[0].id])
  })

  it('keeps the other projects when one fails, and cuts the merged ranking to the limit', async () => {
    const [one, two] = state.reachable
    state.failing.add(one.id)
    state.hits.set(two.id, [hit('x', 0.4, { collectionName: 'proj_2' }), hit('y', 0.3, { collectionName: 'proj_2' }), hit('z', 0.2, { collectionName: 'proj_2' })])

    const result = await searchAcrossProjects(caller(), search({ limit: 2 }))

    expect(result.hits.map((found) => found.filename)).toEqual(['x.pdf', 'y.pdf'])
  })
})
