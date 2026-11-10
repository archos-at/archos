/**
 * @vitest-environment node
 *
 * The resolver on paper fixtures (design §9, "paper" rows): small graphs in the
 * records format a pack is proposed in, each holding one rule of design §3.5.
 * Named like the element ledger's tests (design §3.10).
 */

import { describe, expect, it } from 'vitest'
import { proposedRecordSchema, type ProposedRecord } from '../platform/wire'
import { graphFromProposals, mergeGraphs } from './from-proposals'
import type { EditionUse, ResolvedChain } from './graph'
import { chainAt, MAX_ROUTE_DEPTH, resolveChain } from './resolve'

const parse = (records: unknown[]): ProposedRecord[] => records.map((record) => proposedRecordSchema.parse(record))

const territory = (id: string, kind: string, parentIds: string[] = [], datedParents: object[] = []) => ({
  type: 'territory',
  id,
  kind,
  name: id,
  parents: [...parentIds.map((parent) => ({ id: parent })), ...datedParents],
})
const work = (key: string, kind: string, territoryIds: string[] = [], extra: object = {}) => ({
  type: 'work',
  key,
  kind,
  title: key,
  territoryIds,
  ...extra,
})
const edition = (key: string, workKey: string, issuedOn: string | null, extra: object = {}) => ({
  type: 'edition',
  key,
  workKey,
  label: key,
  issuedOn,
  ...extra,
})
const binds = (key: string, from: string, to: string, extra: object = {}) => ({
  type: 'relation',
  key,
  relationType: 'makes_binding',
  mode: 'declared',
  from: { type: from.split(':')[0], key: from.split(':')[1] },
  to: { type: to.split(':')[0], key: to.split(':')[1] },
  ...extra,
})

const AUSTRIA = [
  territory('EU', 'union'),
  territory('AT', 'country', [], [{ id: 'EU', validFrom: '1995-01-01' }]),
  territory('AT-6', 'state', ['AT']),
  territory('AT-7', 'state', ['AT']),
  territory('AT-9', 'state', ['AT']),
  work('bo-wien', 'statute', ['AT-9']),
  work('wbtv', 'ordinance', ['AT-9']),
  work('stbtv', 'ordinance', ['AT-6']),
  work('tbv', 'ordinance', ['AT-7']),
  work('oib-rl-2', 'model_code', ['AT']),
  work('oib-rl-6', 'model_code', ['AT']),
  edition('oib-rl-2-2019', 'oib-rl-2', '2019-04-12'),
  edition('oib-rl-2-2023', 'oib-rl-2', '2023-05-25'),
  edition('oib-rl-6-2019', 'oib-rl-6', '2019-04-12'),
  edition('oib-rl-6-2023', 'oib-rl-6', '2023-05-25'),
  edition('oib-rl-6-2025', 'oib-rl-6', '2025-08-29'),
  binds('wien-rl2-2023', 'work:wbtv', 'edition:oib-rl-2-2023', { validFrom: '2024-02-23', provision: '§ 1 WBTV 2023' }),
  binds('wien-rl6-2023', 'work:wbtv', 'edition:oib-rl-6-2023', { validFrom: '2024-02-23', validTo: '2026-07-15' }),
  binds('wien-rl6-2025', 'work:wbtv', 'edition:oib-rl-6-2025', { validFrom: '2026-07-15' }),
  binds('stmk-rl2-2019', 'work:stbtv', 'edition:oib-rl-2-2019', { validFrom: '2020-09-01' }),
  binds('tirol-rl6-2019', 'work:tbv', 'edition:oib-rl-6-2019', { validFrom: '2020-06-01', validTo: '2026-07-16' }),
  binds('tirol-rl6-2025', 'work:tbv', 'edition:oib-rl-6-2025', { validFrom: '2026-07-16' }),
  {
    type: 'relation',
    key: 'tirol-rl6-2025-without',
    relationType: 'deviates_from',
    from: { type: 'work', key: 'tbv' },
    to: { type: 'edition', key: 'oib-rl-6-2025' },
    anchors: [{ to: 'pkt_2.2' }, { to: 'pkt_2.3.1' }],
    provision: '§ 43 TBV 2026',
    validFrom: '2026-07-16',
  },
]

const graph = graphFromProposals(parse(AUSTRIA))
const usesOf = (resolved: ResolvedChain, workId: string): EditionUse[] => resolved.uses.filter((use) => use.workId === workId)
const roleOf = (resolved: ResolvedChain, editionId: string) => resolved.uses.find((use) => use.editionId === editionId)?.role ?? null

describe('the chain of a site', () => {
  it('cpr-at-project: Wien lies in Austria and, by its dated parent, in the EU', () => {
    expect(chainAt('AT-9', '2026-11-10', graph)).toEqual(['AT-9', 'AT', 'EU'])
    expect(chainAt('AT-9', '1994-12-31', graph)).toEqual(['AT-9', 'AT'])
  })

  it('gb-2021-no-eu: Great Britain lies in the EU until the end of 2020, and not after', () => {
    const uk = graphFromProposals(parse([territory('EU', 'union'), territory('GB', 'country', [], [{ id: 'EU', validTo: '2021-01-01' }])]))
    expect(chainAt('GB', '2020-12-31', uk)).toContain('EU')
    expect(chainAt('GB', '2021-01-01', uk)).not.toContain('EU')
  })

  it('places an ISO 3166-2 code in its country even without a territory record', () => {
    expect(chainAt('DE-BY', '2026-11-10', graph)).toEqual(['DE-BY', 'DE'])
  })
})

describe('law and routes', () => {
  it('route-wbtv-oib2: in Wien the WBTV declares OIB-RL 2 in its 2023 edition, with the route', () => {
    const resolved = resolveChain(graph, 'AT-9', '2026-11-10')
    const [rl2] = usesOf(resolved, 'work:oib-rl-2').filter((use) => use.role === 'binding')
    expect(rl2.editionId).toBe('edition:oib-rl-2-2023')
    expect(rl2.route.map((step) => [step.via, step.workId])).toEqual([
      ['territory', 'work:wbtv'],
      ['relation', 'work:wbtv'],
    ])
    expect(rl2.route[1].provision).toBe('§ 1 WBTV 2023')
    expect(roleOf(resolved, 'edition:oib-rl-2-2019')).toBe('information')
  })

  it('binds law in its own Land only: the Bauordnung für Wien binds in Wien, not in Graz', () => {
    expect(usesOf(resolveChain(graph, 'AT-9', '2026-11-10'), 'work:bo-wien')).toMatchObject([{ role: 'binding', editionId: null }])
    expect(usesOf(resolveChain(graph, 'AT-6', '2026-11-10'), 'work:bo-wien')).toEqual([])
  })

  it('defect 7: in Steiermark OIB-RL 2 binds in its 2019 edition, and 2023 only guides', () => {
    const resolved = resolveChain(graph, 'AT-6', '2026-11-10')
    expect(roleOf(resolved, 'edition:oib-rl-2-2019')).toBe('binding')
    expect(resolved.uses.find((use) => use.editionId === 'edition:oib-rl-2-2023')).toMatchObject({
      role: 'guidance',
      relatedEditionId: 'edition:oib-rl-2-2019',
    })
  })

  it('a norm no Land declares here guides in its newest edition only', () => {
    // No Styrian relation for RL 6 in this fixture.
    const resolved = resolveChain(graph, 'AT-6', '2026-11-10')
    expect(usesOf(resolved, 'work:oib-rl-6').map((use) => [use.editionId, use.role])).toEqual([
      ['edition:oib-rl-6-2025', 'guidance'],
      ['edition:oib-rl-6-2019', 'information'],
      ['edition:oib-rl-6-2023', 'information'],
    ])
  })

  it('asof-vienna: Wien binds RL 6 in 2023 before 2026-07-15 and in 2025 from that day', () => {
    expect(roleOf(resolveChain(graph, 'AT-9', '2026-07-14'), 'edition:oib-rl-6-2023')).toBe('binding')
    expect(roleOf(resolveChain(graph, 'AT-9', '2026-07-15'), 'edition:oib-rl-6-2025')).toBe('binding')
    expect(roleOf(resolveChain(graph, 'AT-9', '2026-07-15'), 'edition:oib-rl-6-2023')).toBe('information')
  })

  it('tirol-rl6-2025: Tirol binds RL 6 in 2025 from 2026-07-16, without Pkt 2.2 and 2.3.1', () => {
    const [rl6] = usesOf(resolveChain(graph, 'AT-7', '2026-11-10'), 'work:oib-rl-6').filter((use) => use.role === 'binding')
    expect(rl6.editionId).toBe('edition:oib-rl-6-2025')
    expect(rl6.displaced).toEqual([
      { anchor: 'pkt_2.2', replacedBy: null, byWorkId: 'work:tbv', provision: '§ 43 TBV 2026' },
      { anchor: 'pkt_2.3.1', replacedBy: null, byWorkId: 'work:tbv', provision: '§ 43 TBV 2026' },
    ])
    expect(roleOf(resolveChain(graph, 'AT-7', '2026-07-15'), 'edition:oib-rl-6-2019')).toBe('binding')
  })

  it('a law with editions none of which is in force at the date applies to nothing then', () => {
    const dated = graphFromProposals(
      parse([...AUSTRIA, edition('bo-wien-2030', 'bo-wien', null, { inForceFrom: '2030-01-01' })]),
    )
    expect(usesOf(resolveChain(dated, 'AT-9', '2026-11-10'), 'work:bo-wien')).toEqual([])
    expect(usesOf(resolveChain(dated, 'AT-9', '2030-01-01'), 'work:bo-wien')).toMatchObject([{ editionId: 'edition:bo-wien-2030' }])
  })
})

describe('deviations, precedence and packs', () => {
  it('deviation-wbtv-pkt: a WBTV clause displaces an OIB-RL 2 Punkt in Wien, and nowhere else', () => {
    const records = parse([
      ...AUSTRIA,
      {
        type: 'relation',
        key: 'wbtv-replaces-pkt-3-1',
        relationType: 'deviates_from',
        from: { type: 'work', key: 'wbtv' },
        to: { type: 'work', key: 'oib-rl-2' },
        anchors: [{ from: 'par_4', to: 'pkt_3.1' }],
        provision: '§ 4 WBTV 2023',
      },
    ])
    const wien = usesOf(resolveChain(graphFromProposals(records), 'AT-9', '2026-11-10'), 'work:oib-rl-2').find((use) => use.role === 'binding')
    expect(wien?.displaced).toEqual([{ anchor: 'pkt_3.1', replacedBy: 'par_4', byWorkId: 'work:wbtv', provision: '§ 4 WBTV 2023' }])
    const graz = usesOf(resolveChain(graphFromProposals(records), 'AT-6', '2026-11-10'), 'work:oib-rl-2').find((use) => use.role === 'binding')
    expect(graz?.displaced).toEqual([])
  })

  it('E37: an office relation makes a DIN edition binding as office_maintained, and a platform relation displaces it', () => {
    const din = parse([work('din-4109-1', 'technical_standard'), edition('din-4109-1-2018', 'din-4109-1', '2018-01-01')])
    const officeRelation = graphFromProposals(parse([binds('office-din', 'work:wbtv', 'edition:din-4109-1-2018')]), 'office')
    const office = mergeGraphs(graph, graphFromProposals(din), officeRelation)
    expect(roleOf(resolveChain(office, 'AT-9', '2026-11-10'), 'edition:din-4109-1-2018')).toBe('binding')
    expect(resolveChain(office, 'AT-9', '2026-11-10').uses.find((use) => use.editionId === 'edition:din-4109-1-2018')?.qualifier).toBe(
      'office_maintained',
    )
    const platformRelation = graphFromProposals(parse([binds('platform-din', 'work:wbtv', 'edition:din-4109-1-2018')]))
    const both = resolveChain(mergeGraphs(office, platformRelation), 'AT-9', '2026-11-10')
    const use = both.uses.find((candidate) => candidate.editionId === 'edition:din-4109-1-2018')
    expect(use?.qualifier).toBeNull()
    expect(use?.route.at(-1)?.relationId).toBe('relation:platform-din')
  })

  it('keeps an office route that a platform relation from another Land or to another edition does not claim', () => {
    const din = parse([
      work('din-4109-1', 'technical_standard'),
      edition('din-4109-1-2018', 'din-4109-1', '2018-01-01'),
      edition('din-4109-1-2020', 'din-4109-1', '2020-01-01'),
    ])
    const office = graphFromProposals(parse([binds('office-din', 'work:wbtv', 'edition:din-4109-1-2018')]), 'office')
    const styrianPlatform = graphFromProposals(parse([binds('stmk-din', 'work:stbtv', 'edition:din-4109-1-2020')]))
    const resolved = resolveChain(mergeGraphs(graph, graphFromProposals(din), office, styrianPlatform), 'AT-9', '2026-11-10')
    expect(resolved.uses.find((use) => use.editionId === 'edition:din-4109-1-2018')).toMatchObject({
      role: 'binding',
      qualifier: 'office_maintained',
    })
  })

  it('li-sia500: Liechtenstein law reaches SIA and VKF works in another pack through relations', () => {
    const swissBodies = graphFromProposals(
      parse([
        work('sia-500', 'technical_standard'),
        edition('sia-500-2009', 'sia-500', '2009-01-01'),
        work('vkf-brandschutznorm', 'guideline'),
        edition('vkf-2015', 'vkf-brandschutznorm', '2015-01-01'),
      ]),
    )
    const liechtenstein = graphFromProposals(
      parse([
        territory('LI', 'country'),
        work('li-bauv', 'ordinance', ['LI']),
        binds('li-sia500', 'work:li-bauv', 'work:sia-500', { mode: 'dynamic_reference' }),
        binds('li-vkf', 'work:li-bauv', 'edition:vkf-2015'),
      ]),
    )
    const resolved = resolveChain(mergeGraphs(swissBodies, liechtenstein), 'LI', '2026-11-10')
    expect(roleOf(resolved, 'edition:sia-500-2009')).toBe('binding')
    expect(roleOf(resolved, 'edition:vkf-2015')).toBe('binding')
    // The same SIA work is nothing to an Austrian site no route reaches it from.
    expect(roleOf(resolveChain(mergeGraphs(graph, swissBodies), 'AT-9', '2026-11-10'), 'edition:sia-500-2009')).toBeNull()
  })

  it('cpr-at-project and gb-2021-no-eu: an EU regulation binds by dated membership', () => {
    const union = parse([
      territory('GB', 'country', [], [{ id: 'EU', validTo: '2021-01-01' }]),
      work('cpr', 'statute', ['EU']),
      edition('cpr-305-2011', 'cpr', '2011-03-09', { inForceFrom: '2013-07-01' }),
    ])
    const europe = mergeGraphs(graph, graphFromProposals(union))
    expect(roleOf(resolveChain(europe, 'AT-9', '2026-11-10'), 'edition:cpr-305-2011')).toBe('binding')
    expect(roleOf(resolveChain(europe, 'GB', '2020-06-01'), 'edition:cpr-305-2011')).toBe('binding')
    expect(roleOf(resolveChain(europe, 'GB', '2021-06-01'), 'edition:cpr-305-2011')).toBeNull()
  })

  it('fails closed on an undated edition: a dynamic reference to it binds nothing, and it never guides', () => {
    const undated = graphFromProposals(
      parse([
        ...AUSTRIA,
        work('vague', 'technical_standard', ['AT']),
        edition('vague-a', 'vague', null),
        edition('vague-b', 'vague', null),
        binds('wien-vague', 'work:wbtv', 'work:vague', { mode: 'dynamic_reference' }),
      ]),
    )
    const uses = usesOf(resolveChain(undated, 'AT-9', '2026-11-10'), 'work:vague')
    expect(uses.map((use) => use.role)).toEqual(['information', 'information'])
  })

  it('lets no edition that starts after the date guide', () => {
    const future = graphFromProposals(parse([...AUSTRIA, edition('oib-rl-2-2027', 'oib-rl-2', null, { inForceFrom: '2027-06-01' })]))
    expect(roleOf(resolveChain(future, 'AT-6', '2026-11-10'), 'edition:oib-rl-2-2027')).toBe('information')
    expect(roleOf(resolveChain(future, 'AT-6', '2026-11-10'), 'edition:oib-rl-2-2023')).toBe('guidance')
  })

  it('says when it left uses out, so a caller fails closed', () => {
    const many: unknown[] = [territory('AT', 'country'), work('law', 'statute', ['AT'])]
    for (let index = 0; index < 45; index++) many.push(work(`std-${index}`, 'technical_standard', ['AT']), edition(`std-${index}-e`, `std-${index}`, '2020-01-01'))
    const resolved = resolveChain(graphFromProposals(parse(many)), 'AT', '2026-11-10')
    expect(resolved.truncated).toBe(true)
    expect(resolveChain(graph, 'AT-9', '2026-11-10').truncated).toBe(false)
  })

  it('stops a cycle and follows a route no deeper than its limit', () => {
    const chainRecords: unknown[] = [territory('AT', 'country'), work('law', 'statute', ['AT'])]
    for (let index = 0; index <= MAX_ROUTE_DEPTH + 1; index++) {
      chainRecords.push(work(`norm-${index}`, 'technical_standard'), edition(`norm-${index}-e`, `norm-${index}`, '2020-01-01'))
      chainRecords.push(binds(`step-${index}`, index === 0 ? 'work:law' : `work:norm-${index - 1}`, `edition:norm-${index}-e`))
    }
    chainRecords.push(binds('back', `work:norm-3`, 'edition:norm-1-e'))
    const resolved = resolveChain(graphFromProposals(parse(chainRecords)), 'AT', '2026-11-10')
    const bound = resolved.uses.filter((use) => use.role === 'binding' && use.workId.startsWith('work:norm-'))
    expect(bound).toHaveLength(MAX_ROUTE_DEPTH)
    expect(roleOf(resolved, `edition:norm-${MAX_ROUTE_DEPTH}-e`)).toBeNull()
  })

  it('fails closed on a relation to an edition the graph does not hold', () => {
    const graphWithout = graphFromProposals(parse(AUSTRIA.filter((record) => (record as { key?: string }).key !== 'oib-rl-2-2023')))
    expect(roleOf(resolveChain(graphWithout, 'AT-9', '2026-11-10'), 'edition:oib-rl-2-2023')).toBeNull()
    expect(usesOf(resolveChain(graphWithout, 'AT-9', '2026-11-10'), 'work:oib-rl-2').some((use) => use.role === 'binding')).toBe(false)
  })
})

describe('every kind', () => {
  const kinds = parse([
    territory('AT', 'country', [], [{ id: 'EU', validFrom: '1995-01-01' }]),
    territory('EU', 'union'),
    territory('AT-6', 'state', ['AT']),
    territory('AT-9', 'state', ['AT']),
    work('law', 'statute', ['AT-9']),
    work('regulation', 'ordinance', ['AT-9']),
    work('internal', 'administrative_regulation', ['AT-9']),
    edition('internal-e', 'internal', '2020-01-01'),
    work('epbd', 'directive', ['EU']),
    edition('epbd-2024', 'epbd', '2024-04-24'),
    work('treaty', 'intergovernmental_agreement', ['AT']),
    edition('treaty-e', 'treaty', '2010-01-01'),
    work('treaty-unreached', 'intergovernmental_agreement', ['AT']),
    edition('treaty-unreached-e', 'treaty-unreached', '2010-01-01'),
    work('model', 'model_code', ['AT']),
    edition('model-e', 'model', '2023-01-01'),
    work('standard', 'technical_standard', ['AT']),
    edition('standard-e', 'standard', '2017-04-01'),
    work('guide', 'guideline', ['AT']),
    edition('guide-e', 'guide', '2023-01-01'),
    work('commentary', 'commentary', [], { title: 'commentary' }),
    edition('commentary-2018', 'commentary', '2018-01-01'),
    {
      type: 'relation',
      key: 'commentary-on-law',
      relationType: 'interprets',
      from: { type: 'work', key: 'commentary' },
      to: { type: 'work', key: 'law' },
    },
    work('ma37', 'authority_directive', ['AT-9'], { addressees: [{ name: 'MA 37', territoryId: 'AT-9' }] }),
    edition('ma37-e', 'ma37', '2024-01-01'),
    binds('accession', 'work:law', 'edition:treaty-e'),
    binds('directive-is-never-bound', 'work:law', 'edition:epbd-2024'),
    binds('commentary-is-never-bound', 'work:law', 'edition:commentary-2018'),
  ])
  const vienna = resolveChain(graphFromProposals(kinds), 'AT-9', '2026-11-10')
  const graz = resolveChain(graphFromProposals(kinds), 'AT-6', '2026-11-10')

  it.each([
    ['statute', 'work:law', 'binding'],
    ['ordinance', 'work:regulation', 'binding'],
    ['administrative_regulation', 'work:internal', 'information'],
    ['directive', 'work:epbd', 'information'],
    ['intergovernmental_agreement', 'work:treaty', 'binding'],
    ['model_code', 'work:model', 'guidance'],
    ['technical_standard', 'work:standard', 'guidance'],
    ['guideline', 'work:guide', 'guidance'],
    ['commentary', 'work:commentary', 'interpretation'],
    ['authority_directive', 'work:ma37', 'authority_practice'],
  ])('%s reads as its kind and route say', (_kind, workId, role) => {
    expect(usesOf(vienna, workId).map((use) => use.role)).toEqual([role])
  })

  it('an unreached agreement is information, a reached one binds', () => {
    expect(usesOf(vienna, 'work:treaty-unreached').map((use) => use.role)).toEqual(['information'])
  })

  it('directive-ma37-graz: an authority directive and a Land law are nothing to a site outside their Land', () => {
    expect(usesOf(graz, 'work:ma37')).toEqual([])
    expect(usesOf(graz, 'work:law')).toEqual([])
    expect(usesOf(graz, 'work:commentary')).toEqual([])
  })

  it('scopes a commentary by every work it interprets', () => {
    const two = graphFromProposals(
      parse([
        ...kinds.filter((record) => !(record.type === 'relation' && record.key === 'commentary-on-law')),
        work('graz-law', 'statute', ['AT-6']),
        { type: 'relation', key: 'on-graz', relationType: 'interprets', from: { type: 'work', key: 'commentary' }, to: { type: 'work', key: 'graz-law' } },
        { type: 'relation', key: 'on-vienna', relationType: 'interprets', from: { type: 'work', key: 'commentary' }, to: { type: 'work', key: 'law' } },
      ]),
    )
    expect(usesOf(resolveChain(two, 'AT-9', '2026-11-10'), 'work:commentary').map((use) => use.role)).toEqual(['interpretation'])
    expect(usesOf(resolveChain(two, 'AT-6', '2026-11-10'), 'work:commentary').map((use) => use.role)).toEqual(['interpretation'])
  })

  it('a commentary says which edition it interprets', () => {
    expect(usesOf(vienna, 'work:commentary')[0].relatedEditionId).toBeNull()
  })
})
