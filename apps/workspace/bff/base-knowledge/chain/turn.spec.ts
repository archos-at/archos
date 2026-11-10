/**
 * @vitest-environment node
 *
 * With `building-law-chain` off a turn reads no records and times no phase:
 * its trace and its prompt stay what they were (ADR-0168).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { isOrgFeatureEnabled, findProjectProfileInOrg, loadGraph, officeTimeZone } = vi.hoisted(() => ({
  isOrgFeatureEnabled: vi.fn(),
  findProjectProfileInOrg: vi.fn(),
  loadGraph: vi.fn(),
  officeTimeZone: vi.fn(),
}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled }))
vi.mock('@/lib/projects/repository', () => ({ findProjectProfileInOrg }))
vi.mock('@/lib/organizations/time-zone', () => ({ officeTimeZone }))
vi.mock('./load', () => ({ loadGraph }))

import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
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

  it('reads the records once the flag is on (positive control)', async () => {
    isOrgFeatureEnabled.mockResolvedValue(true)
    const time = vi.fn((_name: string, load: () => Promise<unknown>) => load())
    await buildingLawForTurn(ORG, 'project_1', time as never)
    expect(isOrgFeatureEnabled).toHaveBeenCalledWith(FEATURE_FLAGS.buildingLawChain, ORG)
    expect(time).toHaveBeenCalledWith('building-law', expect.any(Function))
    expect(loadGraph).toHaveBeenCalledWith(ORG, 'AT-9')
  })

  it('with the flag off reads nothing, times nothing and carries nothing', async () => {
    isOrgFeatureEnabled.mockResolvedValue(false)
    const time = vi.fn()
    expect(await buildingLawForTurn(ORG, 'project_1', time as never)).toBeNull()
    expect(time).not.toHaveBeenCalled()
    expect(findProjectProfileInOrg).not.toHaveBeenCalled()
    expect(loadGraph).not.toHaveBeenCalled()
  })

  it('carries nothing for a graph that hit its bound', async () => {
    isOrgFeatureEnabled.mockResolvedValue(true)
    loadGraph.mockResolvedValue({ graph, truncated: true })
    expect(await buildingLawForTurn(ORG, 'project_1')).toBeNull()
  })
})
