/**
 * @vitest-environment node
 *
 * The knowledge context of a turn around its resolver (ADR-0173): present on
 * every turn, with no switch (ADR-0175); two offices whose inputs hash alike never share a cached
 * context; a read that fails gives `knowledge_unavailable`, never a context
 * built from nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { findProjectProfileInOrg, loadGraph, officeTimeZone, readOrganizationCountries, cache, getCached } =
  vi.hoisted(() => {
    const cache = new Map<string, unknown>()
    return {
      findProjectProfileInOrg: vi.fn(),
      loadGraph: vi.fn(),
      officeTimeZone: vi.fn(),
      readOrganizationCountries: vi.fn(),
      cache,
      getCached: vi.fn(async (key: string, _ttl: number, loader: () => Promise<unknown>) => {
        if (!cache.has(key)) cache.set(key, await loader())
        return cache.get(key)
      }),
    }
  })
const { unavailableAdd } = vi.hoisted(() => ({ unavailableAdd: vi.fn() }))
vi.mock('@opentelemetry/api', () => ({ metrics: { getMeter: () => ({ createCounter: () => ({ add: unavailableAdd }) }) } }))
vi.mock('@/lib/projects/repository', () => ({ findProjectProfileInOrg }))
vi.mock('@/lib/organizations/time-zone', () => ({ officeTimeZone }))
vi.mock('@/lib/cache', () => ({ getCached }))
vi.mock('@/lib/db/tenant-context', () => ({ withPlatformAccess: async () => [] }))
vi.mock('../chain/load', () => ({ loadGraph }))
vi.mock('../platform/entitlements', () => ({ readOrganizationCountries }))
const { rememberTurnContext, lastAnswerPackSeqs } = vi.hoisted(() => ({ rememberTurnContext: vi.fn(), lastAnswerPackSeqs: vi.fn() }))
vi.mock('./turn-snapshot', () => ({ rememberTurnContext }))
vi.mock('./last-answer', async (original) => ({ ...(await original<typeof import('./last-answer')>()), lastAnswerPackSeqs }))

import { contextCacheKey, contextDigest, knowledgeContextForTurn } from './service'

const AUSTRIA = {
  territories: new Map([['AT', { id: 'AT', kind: 'country', name: 'AT', parentIds: [], datedParents: [], validFrom: null, validTo: null, coverageLevel: 'core' }]]),
  works: new Map(),
  editions: new Map(),
  relations: [],
}

describe('knowledgeContextForTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cache.clear()
    officeTimeZone.mockResolvedValue('Europe/Vienna')
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [{ countryId: 'AT', source: 'home', entitledAt: null }] })
    findProjectProfileInOrg.mockResolvedValue({ profile: { facts: { country: { value: 'at' }, federal_state: { value: 'vienna' } }, assumptions: {}, goals: {}, unknowns: [] } })
    loadGraph.mockResolvedValue({ graph: AUSTRIA, truncated: false })
  })

  it('times the knowledge phase on every turn, with no switch to ask', async () => {
    const time = vi.fn((_name: string, load: () => Promise<unknown>) => load())
    const context = await knowledgeContextForTurn('org_a', 'project_1', time as never)
    expect(time).toHaveBeenCalledWith('knowledge', expect.any(Function))
    expect(context?.gate.state).toBe('core')
    expect(loadGraph).toHaveBeenCalledWith('org_a', 'AT-9')
  })

  it('gives two organizations with equal digests two cache keys, and reads each one’s own graph', async () => {
    await knowledgeContextForTurn('org_a', 'project_1')
    await knowledgeContextForTurn('org_b', 'project_1')
    const keys = getCached.mock.calls.map(([key]) => key)
    expect(keys).toHaveLength(2)
    const digests = keys.map((key) => key.split(':').at(-1))
    expect(digests[0]).toBe(digests[1])
    expect(new Set(keys).size).toBe(2)
    expect(keys[0]).toBe(contextCacheKey('org_a', 'project_1', digests[0] as string))
    expect(loadGraph.mock.calls.map(([organizationId]) => organizationId)).toEqual(['org_a', 'org_b'])
  })

  it('keeps what a conversation’s turn was answered on, so its answer records that (E42)', async () => {
    lastAnswerPackSeqs.mockResolvedValue(null)
    const context = await knowledgeContextForTurn('org_a', 'project_1', undefined, 'conv_1')
    expect(rememberTurnContext).toHaveBeenCalledWith('org_a', 'conv_1', expect.objectContaining({ gate: context?.gate }))
    await knowledgeContextForTurn('org_a', 'project_1')
    expect(rememberTurnContext).toHaveBeenCalledTimes(1)
  })

  it('fails closed to knowledge_unavailable when a read throws', async () => {
    readOrganizationCountries.mockRejectedValue(new Error('database gone'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const context = await knowledgeContextForTurn('org_a', 'project_1')
    expect(context?.gate.state).toBe('knowledge_unavailable')
    expect(context?.retrieval.countries).toEqual([])
    expect(context?.uses).toEqual([])
    expect(unavailableAdd).toHaveBeenCalledWith(1)
  })

  it.each(['operation', 'run'] as const)('counts only a turn’s failed read toward the alert, not an %s’s', async (reader) => {
    readOrganizationCountries.mockRejectedValue(new Error('database gone'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const context = await knowledgeContextForTurn('org_a', 'project_1', undefined, null, reader)
    expect(context?.gate.state).toBe('knowledge_unavailable')
    expect(unavailableAdd).not.toHaveBeenCalled()
  })
})

describe('contextDigest', () => {
  const inputs = { homeCountry: 'AT', entitled: ['AT', 'DE'], sites: [], date: '2026-12-14', packSeqs: { AT: 4, EU: 1 }, procedures: [] }

  it('is the same for the same inputs in any order', () => {
    expect(contextDigest(inputs)).toBe(contextDigest({ ...inputs, entitled: ['DE', 'AT'], packSeqs: { EU: 1, AT: 4 } }))
  })

  it('changes with a release, so a publish is read on the next turn', () => {
    expect(contextDigest(inputs)).not.toBe(contextDigest({ ...inputs, packSeqs: { AT: 5, EU: 1 } }))
  })

  it('changes with an office record or a platform check, which move no pack sequence', () => {
    const stamped = { ...inputs, recordsStamp: '2026-12-14T09:00:00.000Z/2026-12-01T00:00:00.000Z' }
    expect(contextDigest(stamped)).not.toBe(contextDigest({ ...stamped, recordsStamp: '2026-12-14T10:00:00.000Z/2026-12-01T00:00:00.000Z' }))
    expect(contextDigest(stamped)).not.toBe(contextDigest({ ...stamped, recordsStamp: '2026-12-14T09:00:00.000Z/2026-12-14T08:00:00.000Z' }))
  })
})
