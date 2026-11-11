// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json, ../../configs/knowledge-packs/at-golden-cases.json
/**
 * @vitest-environment node
 *
 * The knowledge context of a turn around its resolver (ADR-0173): present on
 * every turn, with no switch (ADR-0175); two offices whose inputs hash alike never share a cached
 * context; a read that fails gives `knowledge_unavailable`, never a context
 * built from nothing.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

import { graphFromProposals } from '../chain/from-proposals'
import { proposedRecordSchema } from '../platform/wire'
import { contextCacheKey, contextDigest, knowledgeContextForStatedSite, knowledgeContextForTurn, referenceDateOf } from './service'

const AUSTRIA = {
  territories: new Map([['AT', { id: 'AT', kind: 'country', name: 'AT', parents: [], validFrom: null, validTo: null, coverageLevel: 'core' }]]),
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

  it('changes with the project’s buildings, so a new use is read by each edition’s scope on the next turn (ADR-0178)', () => {
    const house = { buildingId: 'bldg1', inputs: { uses: ['residential'] } }
    const withGarage = { buildingId: 'bldg1', inputs: { uses: ['residential', 'garage'] } }
    expect(contextDigest({ ...inputs, buildings: { buildings: [house] } })).toBe(contextDigest({ ...inputs, buildings: { buildings: [{ ...house }] } }))
    expect(contextDigest({ ...inputs, buildings: { buildings: [house] } })).not.toBe(contextDigest({ ...inputs, buildings: { buildings: [withGarage] } }))
    expect(contextDigest(inputs)).not.toBe(contextDigest({ ...inputs, buildings: { buildings: [house] } }))
  })
})

const packs = join(process.cwd(), '..', '..', 'configs', 'knowledge-packs')
const records = (name: string) => (JSON.parse(readFileSync(join(packs, name), 'utf8')) as { records: Record<string, unknown>[] }).records
const AUSTRIA_PACKS = graphFromProposals(proposedRecordSchema.array().parse([...records('eu.json'), ...records('at.json')]))
/** Golden case A8: the edition of OIB-RL 2 binding in Wien for a filing on 2023-06-01. */
const A8 = records('at-golden-cases.json').find((record) => record.key === 'at-a8-edition-on-filing-day-with-interval') as {
  context: { territoryId: string; referenceDate: string }
  expected: { edition: { editionKey: string; role: string }; citations: { alsoKnownAs: string[] }[] }
}
const FILING_NOTE = 'the filing day taken as the reference date (an assumption; transitional law not checked: say so)'

describe('referenceDateOf', () => {
  it('takes a filing day that has come, today included, and leaves one still to come undetermined', () => {
    expect(referenceDateOf('2023-06-01', '2026-11-11')).toEqual({ date: '2023-06-01', basis: 'filed_on' })
    expect(referenceDateOf('2026-11-11', '2026-11-11')).toEqual({ date: '2026-11-11', basis: 'filed_on' })
    expect(referenceDateOf('2026-11-12', '2026-11-11')).toEqual({ date: null, basis: 'undetermined' })
    expect(referenceDateOf(null, '2026-11-11')).toEqual({ date: null, basis: 'undetermined' })
  })
})

describe('a filed project’s context resolves on its filing day (country-as-data §3.6)', () => {
  const vienna = { country: { value: 'at' }, federal_state: { value: 'vienna' } }
  const profileWith = (facts: Record<string, { value: string }>) => ({ profile: { facts: { ...vienna, ...facts }, assumptions: {}, goals: {}, unknowns: [] } })
  const oibRl2 = (context: Awaited<ReturnType<typeof knowledgeContextForTurn>>) =>
    Object.fromEntries(context.uses.filter((use) => use.workId === 'work:oib-rl-2').map((use) => [use.editionId, use]))

  beforeEach(() => {
    vi.clearAllMocks()
    cache.clear()
    officeTimeZone.mockResolvedValue('Europe/Vienna')
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [{ countryId: 'AT', source: 'home', entitledAt: null }] })
    loadGraph.mockResolvedValue({ graph: AUSTRIA_PACKS, truncated: false })
  })

  it('binds OIB-RL 2 2019 through the WBTV in Wien on the filing day, not the 2023 edition, and says the day is assumed', async () => {
    findProjectProfileInOrg.mockResolvedValue(profileWith({ 'filed_on@p1': { value: '2023-06-01' } }))
    const context = await knowledgeContextForTurn('org_a', 'project_1')
    expect(context.date).toBe('2023-06-01')
    expect(context.procedures[0]?.referenceDates['AT-9']).toEqual({ date: '2023-06-01', basis: 'filed_on' })
    const editions = oibRl2(context)
    expect(editions['edition:oib-rl-2-2019']).toMatchObject({ role: 'binding', roleSince: '2020-02-01', route: { designation: 'WBTV' } })
    expect(editions['edition:oib-rl-2-2023']?.role).not.toBe('binding')
    expect(context.text).toContain(`on 2023-06-01, ${FILING_NOTE}`)
  })

  it('answers golden case A8 the same way through the stated site a golden run reads', async () => {
    const context = await knowledgeContextForStatedSite('org_a', { territoryId: A8.context.territoryId, filedOn: A8.context.referenceDate })
    expect(context.date).toBe(A8.context.referenceDate)
    // The expectation is the golden case's own, so the spec follows the record if a reviewer rewrites it.
    const { edition, citations } = A8.expected
    const use = context.uses.find((candidate) => candidate.editionId === `edition:${edition.editionKey}`)
    expect(use).toMatchObject({ role: edition.role })
    expect(citations[0]?.alsoKnownAs).toContain(use?.route?.designation)
    expect(context.text).toContain(FILING_NOTE)
  })

  it.each([
    ['a filing day still to come', { 'filed_on@p1': { value: '2999-01-01' } }],
    ['no filing day', {}],
  ])('resolves on today with %s, and says nothing of a filing day', async (_case, facts) => {
    findProjectProfileInOrg.mockResolvedValue(profileWith(facts))
    const context = await knowledgeContextForTurn('org_a', 'project_1')
    expect(context.date).not.toBe('2023-06-01')
    expect(context.date >= '2026-11-11').toBe(true)
    expect(oibRl2(context)['edition:oib-rl-2-2023']?.role).toBe('binding')
    expect(context.text).not.toContain('filing day')
  })
})
