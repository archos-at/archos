/**
 * @vitest-environment node
 *
 * Every turn with a project reads its building law from the records; there is
 * no switch any more (ADR-0175), so an office that never had one still reads it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { findProjectProfileInOrg, loadGraph, officeTimeZone } = vi.hoisted(() => ({
  findProjectProfileInOrg: vi.fn(),
  loadGraph: vi.fn(),
  officeTimeZone: vi.fn(),
}))
vi.mock('@/lib/projects/repository', () => ({ findProjectProfileInOrg }))
vi.mock('@/lib/organizations/time-zone', () => ({ officeTimeZone }))
vi.mock('./load', () => ({ loadGraph }))
vi.mock('@/lib/site-resolution/competence', () => ({ competentAuthorities: async () => [{ status: 'undetermined', reason: 'no_rule' }] }))

import { buildingLawForTurn } from './turn'

const ORG = 'org_1'
const graph = { territories: new Map(), works: new Map(), editions: new Map(), relations: [] }

describe('buildingLawForTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findProjectProfileInOrg.mockResolvedValue({ profile: { facts: { country: { value: 'AT' }, federal_state: { value: 'vienna' } } } })
    loadGraph.mockResolvedValue({ graph, truncated: false })
    officeTimeZone.mockResolvedValue('Europe/Vienna')
  })

  it('reads the records for every office, with no switch to ask', async () => {
    const time = vi.fn((_name: string, load: () => Promise<unknown>) => load())
    await buildingLawForTurn(ORG, 'project_1', time as never)
    expect(time).toHaveBeenCalledWith('building-law', expect.any(Function))
    expect(loadGraph).toHaveBeenCalledWith(ORG, 'AT-9')
  })

  it('without a project reads nothing and carries nothing', async () => {
    const time = vi.fn()
    expect(await buildingLawForTurn(ORG, null, time as never)).toBeNull()
    expect(time).not.toHaveBeenCalled()
    expect(loadGraph).not.toHaveBeenCalled()
  })

  it('carries nothing for a graph that hit its bound', async () => {
    loadGraph.mockResolvedValue({ graph, truncated: true })
    expect(await buildingLawForTurn(ORG, 'project_1')).toBeNull()
  })
})
