/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { graphFromProposals } from '../chain/from-proposals'
import { resolveKnowledgeContext } from '../context/resolve'
import { designationKey } from '../platform'
import { proposedRecordSchema } from '../platform/wire'
import type { StoredEntry } from '../store/repository'
import { bindingNormsOf, bindingOf, bindingStanding, isSameEdition, type BindingNorm } from './binding-edition'

function held(editionId: string, editionLabel: string, values: Partial<StoredEntry['values']> = {}, rest: Partial<StoredEntry> = {}): StoredEntry {
  return {
    workId: 'work_1',
    editionId,
    copyId: `copy_${editionId}`,
    documentId: `doc_${editionId}`,
    workStandsAlone: true,
    confirmed: true,
    provenance: {},
    terms: {},
    lastCheck: null,
    createdAt: new Date('2026-01-01'),
    values: {
      kind: 'technical_standard',
      title: 'Barrierefreies Bauen',
      designation: 'ÖNORM B 1600',
      editionLabel,
      issuedOn: editionLabel,
      inForceFrom: null,
      inForceTo: null,
      territoryIds: [],
      issuer: null,
      addressees: [],
      licenceClass: 'public_open',
      ...values,
    },
    ...rest,
  }
}

const RECORDS = [
  { type: 'territory', id: 'AT', kind: 'country', name: 'Österreich', coverageLevel: 'core' },
  { type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parents: [{ id: 'AT' }], coverageLevel: 'full' },
  { type: 'territory', id: 'AT-6', kind: 'state', name: 'Steiermark', parents: [{ id: 'AT' }], coverageLevel: 'full' },
  { type: 'work', key: 'wbtv', kind: 'ordinance', title: 'Wiener Bautechnikverordnung', territoryIds: ['AT-9'] },
  { type: 'work', key: 'oib-rl-4', kind: 'model_code', title: 'Nutzungssicherheit und Barrierefreiheit', designation: 'OIB-RL 4', territoryIds: ['AT'] },
  { type: 'edition', key: 'oib-rl-4-2023', workKey: 'oib-rl-4', label: '2023', issuedOn: '2023-05-25' },
  { type: 'work', key: 'oenorm-b-1600', kind: 'technical_standard', title: 'Barrierefreies Bauen', designation: 'ÖNORM B 1600', territoryIds: [] },
  { type: 'edition', key: 'oenorm-b-1600-2017', workKey: 'oenorm-b-1600', label: '2017-04-15', issuedOn: '2017-04-15' },
  { type: 'edition', key: 'oenorm-b-1600-2023', workKey: 'oenorm-b-1600', label: '2023-02-01', issuedOn: '2023-02-01' },
  {
    type: 'relation',
    key: 'wbtv-oib-rl-4',
    relationType: 'makes_binding',
    mode: 'declared',
    from: { type: 'work', key: 'wbtv' },
    to: { type: 'edition', key: 'oib-rl-4-2023' },
    validFrom: '2024-02-23',
  },
  {
    type: 'relation',
    key: 'oib-rl-4-oenorm-b-1600',
    relationType: 'makes_binding',
    mode: 'static_reference',
    from: { type: 'edition', key: 'oib-rl-4-2023' },
    to: { type: 'edition', key: 'oenorm-b-1600-2023' },
  },
]

function bindingsAt(territoryId: string, date: string, records: unknown[] = RECORDS) {
  const graph = graphFromProposals(records.map((record) => proposedRecordSchema.parse(record)))
  const context = resolveKnowledgeContext({
    homeCountry: 'AT',
    entitled: new Set(['AT']),
    sites: [{ territoryId, certainty: 'verified' }],
    graph,
    truncated: false,
    date,
    now: new Date(`${date}T08:00:00Z`),
    procedures: [],
    packSeqs: {},
  })
  return bindingNormsOf(context.uses)
}

const OLD = held('e2017', '2017-04-15')
const NEW = held('e2023', '2023-02-01')
const KEY = designationKey('ÖNORM B 1600:2017')

describe('the edition of an office norm the resolver names as binding', () => {
  it('follows a law to an OIB edition and its static reference to the ÖNORM edition, keyed by the designation without its edition', () => {
    expect(bindingsAt('AT-9', '2026-11-19').get(KEY)).toEqual([
      { editionLabel: '2023-02-01', startsOn: '2023-02-01', via: { designation: 'OIB-RL 4', editionLabel: '2023' } },
    ])
  })

  it('names none where no law makes the route, before the law binds it, or without the reference', () => {
    expect(bindingsAt('AT-6', '2026-11-19').get(KEY)).toBeUndefined()
    expect(bindingsAt('AT-9', '2024-01-01').get(KEY)).toBeUndefined()
    expect(bindingsAt('AT-9', '2026-11-19', RECORDS.filter((record) => record.key !== 'oib-rl-4-oenorm-b-1600')).get(KEY)).toBeUndefined()
  })

  it('is current when the office holds that edition, and a newer one when it holds only an older edition', () => {
    const norms = bindingsAt('AT-9', '2026-11-19').get(KEY)
    const via = { designation: 'OIB-RL 4', editionLabel: '2023' }
    expect(bindingStanding([OLD], norms)).toEqual({ editionLabel: '2023-02-01', startsOn: '2023-02-01', via, held: false, newer: true })
    expect(bindingStanding([OLD, NEW], norms)).toEqual({ editionLabel: '2023-02-01', startsOn: '2023-02-01', via, held: true, newer: false })
    expect(bindingOf([OLD, NEW], norms)).toMatchObject({ status: 'held', entry: NEW })
  })

  it('says nothing for a work without binding info or without a confirmed copy, and nothing newer when the office’s copy is the later one', () => {
    const norms: BindingNorm[] = [{ editionLabel: '2017-04-15', startsOn: '2017-04-15', via: null }]
    expect(bindingStanding([OLD], undefined)).toBeNull()
    expect(bindingStanding([{ ...NEW, confirmed: false }], norms)).toBeNull()
    expect(bindingStanding([NEW], norms)).toMatchObject({ held: false, newer: false })
    expect(bindingStanding([held('undated', 'Ausgabe B', { issuedOn: null })], [{ ...norms[0], editionLabel: '2023-02-01', startsOn: '2023-02-01' }])).toMatchObject({ newer: false })
  })

  it('takes only what a route makes binding, never information or a law bound by its territory', () => {
    const route = { workId: 'w', designation: 'OIB-RL 4', editionLabel: '2023', provision: null }
    const use = { role: 'binding' as const, via: 'relation' as const, editionId: 'e', designation: 'ÖNORM B 1600', editionLabel: '2023-02-01', route }
    expect(bindingNormsOf([{ ...use, role: 'information' }, { ...use, via: 'territory', route: null }, { ...use, editionId: null }]).size).toBe(0)
  })

  it('knows the same edition by its label or by a day the two share', () => {
    const edition: BindingNorm = { editionLabel: '2023-02-01', startsOn: '2023-02-01', via: null }
    expect(isSameEdition(held('x', 'Ausgabe 2023-02-01', { issuedOn: null }), edition)).toBe(true)
    expect(isSameEdition(held('x', 'Feb. 2023', { issuedOn: null, inForceFrom: '2023-02-01' }), edition)).toBe(true)
    expect(isSameEdition(held('x', '2023-02-01'), { ...edition, editionLabel: '2023 edition', startsOn: null })).toBe(false)
    expect(isSameEdition(held('x', '2017-04-15'), edition)).toBe(false)
  })
})
