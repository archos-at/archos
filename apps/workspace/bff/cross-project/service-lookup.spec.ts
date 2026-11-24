/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@/lib/db/schema/projects'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  reachable: [] as Project[],
  restrictedFolders: true,
  recorded: [] as Array<{ projectIds: readonly string[]; folderIds: readonly string[] }>,
  recordedFor: [] as string[],
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

import { NotFoundError } from '@/lib/api/errors'
import { listLookupProjects, readProjectBrief } from './service'
import { crossProjectListRequestSchema } from './types'
import { caller, project } from './service.fixtures'

beforeEach(() => {
  vi.clearAllMocks()
  state.reachable = [project(1), project(2), project(3)]
  state.restrictedFolders = true
  state.recorded = []
  state.recordedFor = []
})

describe('listLookupProjects', () => {
  it('lists the reachable projects with their address and period, finds by name or address, and records them', async () => {
    state.reachable = [
      project(1, { profile: { facts: { site_address: { value: 'Hauptstraße 3, Graz', confidence: 'confirmed', source: 'onboarding', updatedAt: '' } }, goals: {}, unknowns: [], assumptions: {} } }),
      project(2),
    ]
    const [one, two] = state.reachable

    const all = await listLookupProjects(caller(two.id), crossProjectListRequestSchema.parse({}))
    expect(all.projects.map((found) => [found.name, found.address, found.current, found.collection])).toEqual([
      ['Projekt 1', 'Hauptstraße 3, Graz', false, 'proj_1'],
      ['Projekt 2', null, true, 'proj_2'],
    ])
    expect(all.projects[0].period).toEqual({ start: '2026-02-15', end: null })
    expect(state.recorded).toEqual([{ projectIds: [one.id], folderIds: [] }])

    const graz = await listLookupProjects(caller(), crossProjectListRequestSchema.parse({ query: 'graz' }))
    expect(graz).toMatchObject({ total: 1 })
  })

  it('filters by period and status, cuts to the limit while counting the rest, and records only what it lists', async () => {
    const result = await listLookupProjects(
      caller(),
      crossProjectListRequestSchema.parse({ from: '2026-03-01', status: 'active', limit: 1 })
    )

    expect(result.total).toBe(3)
    expect(result.projects).toHaveLength(1)
    expect(state.recorded).toEqual([{ projectIds: [state.reachable[0].id], folderIds: [] }])
    expect((await listLookupProjects(caller(), crossProjectListRequestSchema.parse({ status: 'closed' }))).total).toBe(0)
  })
})

describe('readProjectBrief', () => {
  it('reads the confirmed facts and the summary of a project in reach, and records it', async () => {
    state.reachable = [
      project(1, {
        profile: { facts: { construction_method: { value: 'timber', confidence: 'confirmed', source: 'onboarding', updatedAt: '' } }, goals: {}, unknowns: [], assumptions: {} },
        profileDisplay: { title: 'P1', summary: 'Ein Holzbau in Graz.', keyFacts: [], missingInfo: [] },
      }),
    ]

    const brief = await readProjectBrief(caller(), { projectId: state.reachable[0].id })

    expect(brief.summary).toBe('Ein Holzbau in Graz.')
    expect(brief.facts).toContain('construction_method=timber')
    expect(brief.project.collection).toBe('proj_1')
    expect(state.recorded).toEqual([{ projectIds: [state.reachable[0].id], folderIds: [] }])
  })

  it('is a not-found for a project out of reach, and records nothing', async () => {
    await expect(readProjectBrief(caller(), { projectId: project(9).id })).rejects.toBeInstanceOf(NotFoundError)
    expect(state.recorded).toEqual([])
  })
})

describe('the OIB edition a listed project carries', () => {
  const at = (value: string, source: 'agent_suggested' | 'onboarding_default' = 'agent_suggested') => ({
    value,
    status: 'unconfirmed' as const,
    reason: 'Aus den Unterlagen',
    source,
    updatedAt: '',
  })
  const withFact = (value: string) => ({ value, confidence: 'confirmed' as const, source: 'user_confirmed' as const, updatedAt: '' })

  it('is confirmed when a person set it, on find and on the brief', async () => {
    state.reachable = [project(1, { profile: { facts: { oib_edition: withFact('2019') }, goals: {}, unknowns: [], assumptions: {} } })]

    const found = await listLookupProjects(caller(), crossProjectListRequestSchema.parse({}))
    const brief = await readProjectBrief(caller(), { projectId: state.reachable[0].id })

    expect(found.projects[0].oibEdition).toEqual({ value: '2019', confirmed: true })
    expect(brief.project.oibEdition).toEqual({ value: '2019', confirmed: true })
  })

  it('is unconfirmed when only the documents suggest it, and a fact still wins over a suggestion', async () => {
    state.reachable = [
      project(1, { profile: { facts: {}, goals: {}, unknowns: [], assumptions: { oib_edition: at('2015') } } }),
      project(2, {
        profile: {
          facts: { oib_edition: withFact('2019') },
          goals: {},
          unknowns: [],
          assumptions: { oib_edition: at('2015') },
        },
      }),
    ]

    const found = await listLookupProjects(caller(), crossProjectListRequestSchema.parse({}))

    expect(found.projects.map((listed) => listed.oibEdition)).toEqual([
      { value: '2015', confirmed: false },
      { value: '2019', confirmed: true },
    ])
  })

  it('is null when neither a person nor the documents say it, and a wizard default is no evidence', async () => {
    state.reachable = [
      project(1, { profile: { facts: {}, goals: {}, unknowns: [], assumptions: { oib_edition: at('2015', 'onboarding_default') } } }),
    ]

    const found = await listLookupProjects(caller(), crossProjectListRequestSchema.parse({}))
    const brief = await readProjectBrief(caller(), { projectId: state.reachable[0].id })

    expect(found.projects[0].oibEdition).toBeNull()
    expect(brief.project.oibEdition).toBeNull()
  })
})
