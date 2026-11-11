import { describe, expect, it } from 'vitest'
import { lawMapOf } from './law-map'
import { reviewUnitsOf, verdictCalls, VERDICTS_PER_CALL } from './law-map-review'
import type { CaptureView, RevisionView } from './wire'

function revision(type: RevisionView['type'], recordId: string, body: Record<string, unknown>, options: { captureId?: string; by?: string } = {}): RevisionView {
  return {
    revisionId: `00000000-0000-4000-8000-${String(recordId.length).padStart(4, '0')}${recordId.replace(/[^a-z0-9]/gi, '').slice(0, 8).padEnd(8, '0')}`.slice(0, 36),
    recordId,
    type,
    createdBy: options.by ?? 'user_a',
    citations: [{ captureId: options.captureId, quote: 'the words on the page' }],
    claims: Object.entries(body).map(([path, value]) => ({ path, value, decision: null })),
  }
}

const capture = (captureId: string, countsAsFetched: boolean): CaptureView => ({
  captureId,
  changeRequestId: 'cr',
  basis: countsAsFetched ? 'fetched' : 'operator_supplied',
  sourceId: null,
  sourceOrigin: null,
  countsAsFetched,
  url: 'https://gazette.xa.example/1',
  finalUrl: null,
  contentType: 'text/html',
  sha256: 'x'.repeat(64),
  bytes: 1,
  textChars: 1,
  pages: null,
  note: null,
  retrievedAt: '2026-11-01T00:00:00Z',
})

/** XA with one region, its building act and ordinance, a model code in one edition with its text, the adoption, and a golden case. */
const REVISIONS: RevisionView[] = [
  revision('territory', 'XA', { kind: 'country', name: 'Xanadu', parents: [] }),
  revision('territory', 'XA-1', { kind: 'state', name: 'Nordland', parents: [{ id: 'XA' }] }),
  revision('work', 'work:ba-n', { kind: 'statute', title: 'Building Act Nordland', territoryIds: ['XA-1'] }),
  revision('work', 'work:to-n', { kind: 'ordinance', title: 'Technical Ordinance Nordland', territoryIds: ['XA-1'] }),
  revision('work', 'work:mc-2', { kind: 'model_code', title: 'Fire', identifiers: { designation: 'MC 2' }, territoryIds: ['XA'] }),
  revision('edition', 'edition:mc-2-2023', { workId: 'work:mc-2', label: 'Edition 2023' }),
  revision('manifestation', 'manifestation:mc-2-2023-text', { editionId: 'edition:mc-2-2023', form: 'text', corpusFile: 'mc-2.pdf' }),
  revision('relation', 'relation:n-2-23', { relationType: 'makes_binding', fromId: 'work:to-n', fromType: 'work', toId: 'edition:mc-2-2023', toType: 'edition', validFrom: '2024-03-01' }, { captureId: 'pasted', by: 'user_b' }),
  revision('golden_case', 'golden_case:fire-1', { question: 'How long may an escape route be?' }),
]

describe('reviewUnitsOf', () => {
  const map = lawMapOf('XA', REVISIONS, [capture('pasted', false)])
  const units = reviewUnitsOf(map, { revisions: REVISIONS, captures: [capture('pasted', false)], texts: [] })

  it('puts every record in exactly one unit, grouped by what a person decides', () => {
    expect(units.map((one) => [one.key, one.revisions.map((revision) => revision.recordId)])).toEqual([
      ['work:to-n|2024-03-01', ['relation:n-2-23', 'work:to-n']],
      ['statute:work:ba-n', ['work:ba-n']],
      ['regions', ['XA', 'XA-1']],
      // A series' edition of a year comes with its work and its text, confirmed in one.
      ['batch:MC 2023', ['work:mc-2', 'edition:mc-2-2023', 'manifestation:mc-2-2023-text']],
      ['kind:golden_case', ['golden_case:fire-1']],
    ])
    expect(units.flatMap((one) => one.revisions).length).toBe(REVISIONS.length)
    expect(units.at(-1)?.label).toBe('golden_case')
  })

  it('confirms a country the size of Austria in a few dozen units, not one per record', () => {
    // Nine guidelines in two editions each, a text each, a document added outside any statement, and two of each other kind.
    const many: RevisionView[] = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [
        revision('work', `work:mc-${n}`, { kind: 'model_code', title: `Guideline ${n}`, identifiers: { designation: `MC ${n}` }, territoryIds: ['XA'] }),
        ...['2019', '2023'].flatMap((year) => [
          revision('edition', `edition:mc-${n}-${year}`, { workId: `work:mc-${n}`, label: `Edition ${year}`, issuedOn: `${year}-05-01` }),
          revision('manifestation', `manifestation:mc-${n}-${year}`, { editionId: `edition:mc-${n}-${year}`, corpusFile: `mc-${n}-${year}.pdf` }),
        ]),
      ]),
      ...['source:xa-gazette', 'source:xa-guidelines'].map((id) => revision('source', id, { title: id })),
      ...['golden_case:a', 'golden_case:b'].map((id) => revision('golden_case', id, { question: id })),
      ...['ruleset:a', 'ruleset:b'].map((id) => revision('ruleset', id, { purpose: id })),
    ]
    const grouped = reviewUnitsOf(lawMapOf('XA', many, []), { revisions: many, captures: [], texts: [] })
    expect(grouped.map((one) => one.key)).toEqual(['batch:MC 2019', 'batch:MC 2023', 'kind:source', 'kind:golden_case', 'kind:ruleset'])
    // Each work rides with its newest edition; the older year holds only editions and texts.
    expect(grouped[1]?.revisions.filter((one) => one.type === 'work')).toHaveLength(9)
    expect(grouped[0]?.revisions).toHaveLength(18)
    expect(grouped.flatMap((one) => one.revisions)).toHaveLength(many.length)
  })

  it('knows who wrote a unit and which of its records needs a person’s source check', () => {
    expect(units[0]?.authors).toEqual(['user_b', 'user_a'])
    expect(units[0]?.uncheckedRevisionIds).toEqual([REVISIONS[7]?.revisionId])
    expect(units[0]?.uncheckedSources).toEqual([{ url: 'https://gazette.xa.example/1', quote: 'the words on the page' }])
    expect(units[1]?.uncheckedRevisionIds).toEqual([])
  })

  it('sends one verdict per claim not yet carrying it, at most a call’s worth at a time', () => {
    const calls = verdictCalls(units[0]!, 'accepted', { sourceChecked: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.decisions).toHaveLength(9)
    // The relation's six claims carry the check; the act it names, fetched by nobody's paste, does not.
    expect(calls[0]?.decisions.filter((one) => one.sourceChecked).map((one) => one.revisionId)).toEqual(Array(6).fill(REVISIONS[7]?.revisionId))
    expect(verdictCalls(units[0]!, 'rejected', { note: 'no', sourceChecked: true })[0]?.decisions.some((one) => one.sourceChecked)).toBe(false)
    const big = { ...units[0]!, revisions: [{ ...REVISIONS[0]!, claims: Array.from({ length: VERDICTS_PER_CALL + 1 }, (_, index) => ({ path: `p${index}`, value: index, decision: null })) }] }
    expect(verdictCalls(big, 'rejected', { note: 'wrong date' }).map((call) => call.decisions.length)).toEqual([VERDICTS_PER_CALL, 1])
  })
})
