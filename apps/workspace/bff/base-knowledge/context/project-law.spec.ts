/**
 * @vitest-environment node
 *
 * The law a project's page shows is the law its turn reads (ADR-0175): the
 * uses of the same cached resolution, in the roles and with the qualifier the
 * turn reads, never the chain's raw roles. Open coverage names binding law
 * uncurated and the rest information; a work that connects by more than the
 * site informs. Where the gate refuses, nothing is named.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { findProjectProfileInOrg, loadGraph, officeTimeZone, readOrganizationCountries } = vi.hoisted(() => ({
  findProjectProfileInOrg: vi.fn(),
  loadGraph: vi.fn(),
  officeTimeZone: vi.fn(),
  readOrganizationCountries: vi.fn(),
}))
vi.mock('@opentelemetry/api', () => ({ metrics: { getMeter: () => ({ createCounter: () => ({ add: () => undefined }) }) } }))
vi.mock('@/lib/projects/repository', () => ({ findProjectProfileInOrg }))
vi.mock('@/lib/organizations/time-zone', () => ({ officeTimeZone }))
vi.mock('@/lib/cache', () => ({ getCached: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load() }))
vi.mock('@/lib/db/tenant-context', () => ({ withPlatformAccess: async () => [] }))
vi.mock('../chain/load', () => ({ loadGraph }))
vi.mock('@/lib/site-resolution/competence', () => ({ competentAuthorities: async () => [{ status: 'undetermined', reason: 'no_rule' }] }))
vi.mock('../platform/entitlements', () => ({ readOrganizationCountries }))
vi.mock('./turn-snapshot', () => ({ rememberTurnContext: vi.fn() }))

import { proposedRecordSchema } from '../platform/wire'
import { graphFromProposals } from '../chain/from-proposals'
import { gateNamesLaw, lawOf, projectLawFor } from './project-law'
import { knowledgeContextForTurn } from './service'

/** Wien with its Bauordnung, OIB-RL 2 guiding there, and the HOAI connecting by the office's seat. */
const graphAt = (coverageLevel: 'open' | 'core') => {
  const graph = graphFromProposals(
    [
      { type: 'territory', id: 'AT', kind: 'country', name: 'Österreich', coverageLevel },
      { type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parentIds: ['AT'] },
      { type: 'work', key: 'bo-wien', kind: 'statute', title: 'Bauordnung für Wien', designation: 'BO für Wien', territoryIds: ['AT-9'] },
      { type: 'edition', key: 'bo-wien-2024', workKey: 'bo-wien', label: 'LGBl. 2024/1', issuedOn: '2024-01-01', inForceFrom: '2024-01-01' },
      { type: 'work', key: 'oib-rl-2', kind: 'model_code', title: 'Brandschutz', designation: 'OIB-RL 2', territoryIds: ['AT'] },
      { type: 'edition', key: 'oib-rl-2-2023', workKey: 'oib-rl-2', label: '2023', issuedOn: '2023-05-25' },
    ].map((record) => proposedRecordSchema.parse(record)),
  )
  // Checked today: an uncurated edition nobody checked is stale and reads as information (E28).
  const editions = new Map(graph.editions)
  const bauordnung = editions.get('edition:bo-wien-2024')
  if (bauordnung) editions.set(bauordnung.id, { ...bauordnung, lastCheck: { checkedAt: new Date().toISOString(), result: 'current' } })
  return { ...graph, editions }
}

describe('projectLawFor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    officeTimeZone.mockResolvedValue('Europe/Vienna')
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [{ countryId: 'AT', source: 'home', entitledAt: null }] })
    findProjectProfileInOrg.mockResolvedValue({ profile: { facts: { country: { value: 'at' }, federal_state: { value: 'vienna' } }, assumptions: {} } })
  })

  it('names in core coverage the law the turn reads, binding, with designation and edition', async () => {
    loadGraph.mockResolvedValue({ graph: graphAt('core'), truncated: false })
    const law = await projectLawFor('org_at', 'project_wien')
    expect(law.gate).toBe('core')
    expect(law.uses).toContainEqual({ workId: 'work:bo-wien', editionId: 'edition:bo-wien-2024', role: 'binding', qualifier: null, designation: 'BO für Wien', editionLabel: 'LGBl. 2024/1' })
  })

  it('names binding law uncurated and guidance as information where nobody curated the records (open coverage), as the turn reads them', async () => {
    loadGraph.mockResolvedValue({ graph: graphAt('open'), truncated: false })
    const law = await projectLawFor('org_at', 'project_wien')
    const turn = await knowledgeContextForTurn('org_at', 'project_wien')
    expect(law.gate).toBe('open')
    expect(law.uses.find((use) => use.workId === 'work:bo-wien')).toMatchObject({ role: 'binding', qualifier: 'uncurated' })
    expect(law.uses.find((use) => use.workId === 'work:oib-rl-2')).toMatchObject({ role: 'information', qualifier: null })
    // The chain alone would have called the Bauordnung plainly binding and OIB-RL 2 guidance.
    // The page and the turn: the same uses, in the same roles.
    expect(law.uses.map(({ workId, editionId, role, qualifier }) => ({ workId, editionId, role, qualifier }))).toEqual(
      turn.uses.map(({ workId, editionId, role, qualifier }) => ({ workId, editionId, role, qualifier })),
    )
  })

  it('names nothing where the office is not entitled to the site’s country, and reads no graph', async () => {
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [] })
    expect(await projectLawFor('org_at', 'project_wien')).toEqual({ gate: 'not_entitled', uses: [] })
    expect(loadGraph).not.toHaveBeenCalled()
  })

  it('says the law could not be read when a read fails, never that none applies', async () => {
    readOrganizationCountries.mockRejectedValue(new Error('database gone'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await projectLawFor('org_at', 'project_wien')).toEqual({ gate: 'knowledge_unavailable', uses: [] })
  })
})

describe('lawOf', () => {
  it.each(['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', 'none'] as const)(
    'names nothing where the gate is %s, whatever the context holds',
    (state) => {
      const use = { workId: 'work:x', editionId: null, role: 'binding' as const, qualifier: null, via: 'territory' as const, date: '2026-11-10', freshness: 'current' as const, lastCheckedAt: null, connectsBy: ['site' as const], labels: [], corpusFiles: [] }
      const context = { gate: { state, reason: null, leaves: [] }, packs: [], chains: {}, date: '2026-11-10', procedures: [], uses: [use], retrieval: { countries: [] } }
      expect(lawOf({ context, names: { works: {}, editions: {} } })).toEqual({ gate: state, uses: [] })
    },
  )

  it('lets every coverage level but none name law', () => {
    expect(gateNamesLaw('open')).toBe(true)
    expect(gateNamesLaw('none')).toBe(false)
  })
})
