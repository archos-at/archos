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
vi.mock('../platform/entitlements', () => ({ readOrganizationCountries }))
vi.mock('./turn-snapshot', () => ({ rememberTurnContext: vi.fn() }))

import { proposedRecordSchema } from '../platform/wire'
import { graphFromProposals } from '../chain/from-proposals'
import { gateNamesLaw } from '../wire/project-law'
import { lawOf, projectLawFor } from './project-law'
import { knowledgeContextForTurn } from './service'
import { knowledgeContextSchema } from './wire'

/** A synthetic scope shaped like a guideline for production buildings (ADR-0178); the real one is a record citing its clause. */
const PRODUCTION_ONLY = {
  inputs: [{ key: 'uses', type: 'codes' }],
  output: { type: 'boolean' },
  rows: [
    { id: 'production', when: { in: ['production', { var: 'uses' }] }, then: true, provision: { citation: 'scope clause (synthetic)' } },
    { id: 'other-uses', when: { '!': { in: ['production', { var: 'uses' }] } }, then: false },
  ],
  otherwise: { undetermined: true },
}

const placedWith = (uses: string[]) => ({
  profile: { facts: { country: { value: 'at' }, federal_state: { value: 'vienna' }, 'uses@bldg1': { value: uses } }, assumptions: {}, goals: {}, unknowns: [] },
})

/** Wien with its Bauordnung, OIB-RL 2 guiding there, and the HOAI connecting by the office's seat. */
const graphAt = (coverageLevel: 'open' | 'core') => {
  const graph = graphFromProposals(
    [
      { type: 'territory', id: 'AT', kind: 'country', name: 'Österreich', coverageLevel },
      { type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parents: [{ id: 'AT' }] },
      { type: 'work', key: 'bo-wien', kind: 'statute', title: 'Bauordnung für Wien', designation: 'BO für Wien', territoryIds: ['AT-9'], identifiers: { 'ris_gesetzesnummer': '20000006', 'xa_gazette_number': '42' } },
      { type: 'edition', key: 'bo-wien-2024', workKey: 'bo-wien', label: 'LGBl. 2024/1', issuedOn: '2024-01-01', inForceFrom: '2024-01-01' },
      { type: 'work', key: 'oib-rl-2', kind: 'model_code', title: 'Brandschutz', designation: 'OIB-RL 2', territoryIds: ['AT'] },
      { type: 'edition', key: 'oib-rl-2-2023', workKey: 'oib-rl-2', label: '2023', issuedOn: '2023-05-25' },
      { type: 'work', key: 'oib-rl-2-1', kind: 'model_code', title: 'Brandschutz bei Betriebsbauten', designation: 'OIB-RL 2.1', territoryIds: ['AT'] },
      { type: 'edition', key: 'oib-rl-2-1-2023', workKey: 'oib-rl-2-1', label: '2023', issuedOn: '2023-05-25', appliesWhen: PRODUCTION_ONLY },
      {
        type: 'manifestation',
        key: 'oib-rl-2-1-2023-text',
        editionKey: 'oib-rl-2-1-2023',
        form: 'text',
        language: 'de',
        licenceClass: 'public_open',
        citations: [{ url: 'https://www.oib.or.at/kernaufgaben/oib-richtlinien/', note: 'published by the OIB' }],
      },
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
    findProjectProfileInOrg.mockResolvedValue({ profile: { facts: { country: { value: 'at' }, federal_state: { value: 'vienna' } }, assumptions: {}, goals: {}, unknowns: [] } })
  })

  it('names in core coverage the law the turn reads, binding, with designation and edition', async () => {
    loadGraph.mockResolvedValue({ graph: graphAt('core'), truncated: false })
    const law = await projectLawFor('org_at', 'project_wien')
    expect(law.gate).toBe('core')
    expect(law.uses).toContainEqual({ workId: 'work:bo-wien', editionId: 'edition:bo-wien-2024', role: 'binding', qualifier: null, designation: 'BO für Wien', editionLabel: 'LGBl. 2024/1', applicability: null, sourceUrl: null })
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

  it('names an edition for a production hall by its own scope, saying why, and not for flats, on the page as in the turn (ADR-0178)', async () => {
    loadGraph.mockResolvedValue({ graph: graphAt('core'), truncated: false })
    findProjectProfileInOrg.mockResolvedValue(placedWith(['production']))
    const hall = await projectLawFor('org_at', 'project_halle')
    expect(hall.uses.find((use) => use.workId === 'work:oib-rl-2-1')).toMatchObject({
      designation: 'OIB-RL 2.1',
      applicability: { verdict: 'applies', basis: ['uses'], open: [], provision: 'scope clause (synthetic)' },
      sourceUrl: 'https://www.oib.or.at/kernaufgaben/oib-richtlinien/',
    })
    // The fact is named in the country's own terms, from its fact definitions.
    expect(hall.factLabels).toEqual({ uses: 'Nutzungen' })
    // A project filed before its country's fact definitions resolves on that day; the labels are still read today.
    const filed = await knowledgeContextForTurn('org_at', 'project_halle')
    expect(lawOf({ ...filed, date: '2020-01-01' }).factLabels).toEqual({ uses: 'Nutzungen' })
    const turn = await knowledgeContextForTurn('org_at', 'project_halle')
    expect(turn.uses.map((use) => use.workId)).toContain('work:oib-rl-2-1')
    expect(turn.text).toContain("applies to this project by its building's uses")
    findProjectProfileInOrg.mockResolvedValue(placedWith(['residential']))
    const flats = await projectLawFor('org_at', 'project_wohnbau')
    expect(flats.uses.map((use) => use.workId)).not.toContain('work:oib-rl-2-1')
    expect(flats.uses.map((use) => use.workId)).toContain('work:oib-rl-2')
    const flatsTurn = await knowledgeContextForTurn('org_at', 'project_wohnbau')
    expect(flatsTurn.uses.map((use) => use.workId)).not.toContain('work:oib-rl-2-1')
    expect(flatsTurn.text).not.toContain('OIB-RL 2.1')
  })

  it('asks for the deciding fact while it is open, and never says the edition binds or does not', async () => {
    loadGraph.mockResolvedValue({ graph: graphAt('core'), truncated: false })
    findProjectProfileInOrg.mockResolvedValue(placedWith([]))
    const turn = await knowledgeContextForTurn('org_at', 'project_offen')
    expect(turn.uses.find((use) => use.workId === 'work:oib-rl-2-1')?.applicability).toMatchObject({ verdict: 'check', open: ['uses'] })
    expect(turn.text).toContain("applies only if the building's uses put it in scope, not yet known")
  })

  it('names nothing where the office is not entitled to the site’s country, and reads no graph', async () => {
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [] })
    expect(await projectLawFor('org_at', 'project_wien')).toEqual({ gate: 'not_entitled', uses: [], factLabels: {} })
    expect(loadGraph).not.toHaveBeenCalled()
  })

  it('says the law could not be read when a read fails, never that none applies', async () => {
    readOrganizationCountries.mockRejectedValue(new Error('database gone'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await projectLawFor('org_at', 'project_wien')).toEqual({ gate: 'knowledge_unavailable', uses: [], factLabels: {} })
    // A page polls: its failure has its own marker, never the turn alert's line (ADR-0173).
    const lines = logged.mock.calls.map(([line]) => String(line))
    expect(lines.some((line) => line.startsWith('[knowledge_context_page_read=false]'))).toBe(true)
    expect(lines.some((line) => line.includes('knowledge_context_available=false'))).toBe(false)
  })
})

describe('the one payload a turn reads (ADR-0175)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    officeTimeZone.mockResolvedValue('Europe/Vienna')
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [{ countryId: 'AT', source: 'home', entitledAt: null }] })
    findProjectProfileInOrg.mockResolvedValue({ profile: { facts: { country: { value: 'at' }, federal_state: { value: 'vienna' } }, assumptions: {}, goals: {}, unknowns: [] } })
  })

  it('names each use and carries its work’s identifiers at its source, by scheme', async () => {
    loadGraph.mockResolvedValue({ graph: graphAt('core'), truncated: false })
    const context = await knowledgeContextForTurn('org_at', 'project_wien')
    expect(context.uses.find((use) => use.workId === 'work:bo-wien')).toMatchObject({
      designation: 'BO für Wien',
      editionLabel: 'LGBl. 2024/1',
      sourceRefs: [
        { scheme: 'ris_gesetzesnummer', value: '20000006' },
        { scheme: 'xa_gazette_number', value: '42' },
      ],
    })
    expect(context.uses.find((use) => use.workId === 'work:oib-rl-2')).toMatchObject({ sourceRefs: [] })
  })

  it('carries a scheme no code names, as the record states it, through the turn’s wire', async () => {
    loadGraph.mockResolvedValue({ graph: graphAt('core'), truncated: false })
    const context = knowledgeContextSchema.parse(await knowledgeContextForTurn('org_at', 'project_wien'))
    expect(context.uses.find((use) => use.workId === 'work:bo-wien')?.sourceRefs).toContainEqual({ scheme: 'xa_gazette_number', value: '42' })
  })

  it('writes the chain text in the roles its uses carry: guidance where curated, information where nobody curated it', async () => {
    loadGraph.mockResolvedValue({ graph: graphAt('core'), truncated: false })
    const core = await knowledgeContextForTurn('org_at', 'project_wien')
    expect(core.text).toContain('Binding here:')
    expect(core.text).toContain('BO für Wien „Bauordnung für Wien“, edition LGBl. 2024/1')
    expect(core.text).toContain('OIB-RL 2 „Brandschutz“, edition 2023: guidance only')
    loadGraph.mockResolvedValue({ graph: graphAt('open'), truncated: false })
    const open = await knowledgeContextForTurn('org_at', 'project_wien')
    expect(open.uses.find((use) => use.workId === 'work:oib-rl-2')?.role).toBe('information')
    // The chain alone calls OIB-RL 2 guidance; the turn reads it as information, and so does its text.
    expect(open.text).not.toContain('guidance only')
    expect(open.text).toContain('2 other editions are not in force here and are information only.')
  })

  it('carries no text where the gate names no law', async () => {
    readOrganizationCountries.mockResolvedValue({ homeCountry: 'AT', entitled: [] })
    expect((await knowledgeContextForTurn('org_at', 'project_wien')).text).toBeNull()
  })
})

describe('lawOf', () => {
  it.each(['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', 'none'] as const)(
    'names nothing where the gate is %s, whatever the context holds',
    (state) => {
      const use = { workId: 'work:x', editionId: null, role: 'binding' as const, qualifier: null, via: 'territory' as const, date: '2026-11-10', freshness: 'current' as const, lastCheckedAt: null, connectsBy: ['site' as const], labels: [], corpusFiles: [], designation: null, editionLabel: null, sourceRefs: [], sourceUrl: null, route: null, roleSince: null, language: null, textStatus: null, applicability: null }
      const context = { gate: { state, reason: null, leaves: [] }, packs: [], chains: {}, date: '2026-11-10', procedures: [], uses: [use], text: null, retrieval: { countries: [] } }
      expect(lawOf(context)).toEqual({ gate: state, uses: [], factLabels: {} })
    },
  )

  it('lets every coverage level but none name law', () => {
    expect(gateNamesLaw('open')).toBe(true)
    expect(gateNamesLaw('none')).toBe(false)
  })
})
