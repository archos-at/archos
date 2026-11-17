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
import { searchAcrossProjects } from './service'
import { caller, project, search } from './service.fixtures'

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

describe('the decisions other projects recorded', () => {
  const decision = (projectId: string, extra: Record<string, unknown> = {}) => ({
    projectId,
    kind: 'decision',
    content: 'Stiegenhaus in Stahlbeton, weil das Gutachten nur so die Abweichung zuließ.',
    confirmed: true,
    verification: 'unverified',
    evidence: [],
    updatedAt: new Date('2022-05-01T08:00:00Z'),
    restrictedFolderIds: null,
    ...extra,
  })

  it('come first in the answer, named by their project, and are recorded with their project and folders', async () => {
    const [one, two] = state.reachable
    state.decisions = [decision(one.id), decision(two.id, { kind: 'constraint', restrictedFolderIds: ['folder-vertrag'] })]

    const result = await searchAcrossProjects(caller(), search({}))

    expect(result.decisions).toEqual([
      {
        project: { id: one.id, name: 'Projekt 1', status: 'active', federal_state: null },
        collection: 'proj_1',
        kind: 'decision',
        content: 'Stiegenhaus in Stahlbeton, weil das Gutachten nur so die Abweichung zuließ.',
        origin: 'person',
        confirmed: true,
        evidence: [],
        recordedAt: '2022-05-01T08:00:00.000Z',
        restricted: false,
      },
      expect.objectContaining({ kind: 'constraint', restricted: true }),
    ])
    expect(state.recorded).toEqual([{ projectIds: [one.id, two.id], folderIds: ['folder-vertrag'] }])
  })

  it('say who stands behind each: the documents it was read from with their evidence, a person, or the agent alone', async () => {
    const [one, two, three] = state.reachable
    const evidence = [{ fileName: 'Bescheid.pdf', page: '3' }]
    state.decisions = [
      decision(one.id, { confirmed: false, verification: 'source_grounded', evidence }),
      decision(two.id, { confirmed: true, verification: 'source_grounded', evidence }),
      decision(three.id, { confirmed: false, verification: 'unverified' }),
    ]

    const result = await searchAcrossProjects(caller(), search({}))

    expect(result.decisions.map(({ origin, confirmed, evidence }) => ({ origin, confirmed, evidence }))).toEqual([
      { origin: 'documents', confirmed: false, evidence },
      { origin: 'person', confirmed: true, evidence },
      { origin: 'agent', confirmed: false, evidence: [] },
    ])
  })

  it('come only from the page of projects searched, never from the conversation’s own', async () => {
    const [one, two, three] = state.reachable

    await searchAcrossProjects(caller(two.id), search({}))

    expect(state.decisionScopes.map((scope) => scope.projectId)).toEqual([one.id, three.id])
  })

  it('include restricted memory only in a solo chat, by the asker’s clearance in each project', async () => {
    const [one] = state.reachable
    state.readable.set(one.id, ['folder-vertrag'])

    await searchAcrossProjects(caller(), search({}))
    expect(state.decisionScopes.find((scope) => scope.projectId === one.id)?.readableFolderIds).toEqual(['folder-vertrag'])

    state.decisionScopes = []
    state.restrictedFolders = false
    await searchAcrossProjects(caller(), search({}))
    expect(state.decisionScopes.every((scope) => scope.readableFolderIds.length === 0)).toBe(true)
  })
})

describe('the permit records other projects went through', () => {
  const permit = (projectId: string, extra: Record<string, unknown> = {}) => ({
    projectId,
    collectionName: 'proj_1',
    fileName: 'Baubescheid_Baden_2020.pdf',
    kind: 'information_request',
    authority: 'Stadtgemeinde Baden',
    municipality: 'Baden',
    federal_state: 'lower_austria',
    issuedOn: '2020-03-12',
    reference: 'BA-123/2020',
    requirements: [
      { kind: 'information_request', content: 'Ein Brandschutzgutachten ist vorzulegen.', evidence: 'Gutachten', legalBasis: '§ 13 Abs. 3 AVG', page: 2 },
    ],
    restrictedFolderIds: null,
    ...extra,
  })

  it('are named by their project, shaped as the contract says, and recorded with their project and folders', async () => {
    const [one, two] = state.reachable
    state.permits = [permit(one.id), permit(two.id, { collectionName: 'proj_2__vertrag', restrictedFolderIds: ['folder-vertrag'] })]

    const result = await searchAcrossProjects(caller(), search({}))

    expect(result.permits).toEqual([
      {
        project: { id: one.id, name: 'Projekt 1', status: 'active', federal_state: null },
        collection: 'proj_1',
        fileName: 'Baubescheid_Baden_2020.pdf',
        kind: 'information_request',
        authority: 'Stadtgemeinde Baden',
        municipality: 'Baden',
        issuedOn: '2020-03-12',
        reference: 'BA-123/2020',
        requirements: [
          { kind: 'information_request', content: 'Ein Brandschutzgutachten ist vorzulegen.', evidence: 'Gutachten', legalBasis: '§ 13 Abs. 3 AVG', page: 2 },
        ],
        restricted: false,
      },
      expect.objectContaining({ collection: 'proj_2__vertrag', restricted: true }),
    ])
    expect(state.recorded).toEqual([{ projectIds: [one.id, two.id], folderIds: ['folder-vertrag'] }])
  })

  it('record a running project and a restricted folder even when nothing else was found', async () => {
    const [one] = state.reachable
    state.permits = [permit(one.id, { restrictedFolderIds: ['folder-a', 'folder-b'] })]

    await searchAcrossProjects(caller(), search({}))

    expect(state.recorded).toEqual([{ projectIds: [one.id], folderIds: ['folder-a', 'folder-b'] }])
    expect(state.recordedFor).toEqual(['audience-key'])
  })

  it('are searched over the decisions’ scopes: the page of projects searched, never the conversation’s own', async () => {
    const [one, two, three] = state.reachable
    state.readable.set(one.id, ['folder-vertrag'])

    await searchAcrossProjects(caller(two.id), search({}))

    expect(state.permitScopes).toEqual([
      { projectId: one.id, readableFolderIds: ['folder-vertrag'] },
      { projectId: three.id, readableFolderIds: [] },
    ])
    expect(state.permitScopes).toEqual(state.decisionScopes)
  })

  it('leave a restricted folder to a solo chat: a shared chat asks with no clearance', async () => {
    const [one] = state.reachable
    state.readable.set(one.id, ['folder-vertrag'])
    state.restrictedFolders = false

    await searchAcrossProjects(caller(), search({}))

    expect(state.permitScopes.length).toBeGreaterThan(0)
    expect(state.permitScopes.every((scope) => scope.readableFolderIds.length === 0)).toBe(true)
  })

  it('leave out a record of a project outside the page, as a decision of one is left out', async () => {
    state.permits = [permit(project(9).id)]

    const result = await searchAcrossProjects(caller(), search({}))

    expect(result.permits).toEqual([])
    expect(state.recorded).toEqual([{ projectIds: [], folderIds: [] }])
  })
})
