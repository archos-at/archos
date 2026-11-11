import { describe, expect, it } from 'vitest'
import { bindingOn, lawMapOf, nextChange, reviewCounts, summaryOn } from './law-map'
import type { CaptureView, RevisionView } from './wire'

type Decision = 'accepted' | 'rejected' | null

/** A revision as the review reads it: each stated field a claim. */
function revision(type: RevisionView['type'], recordId: string, body: Record<string, unknown>, options: { url?: string; captureId?: string; decision?: Decision } = {}): RevisionView {
  return {
    revisionId: `rev-${recordId}`,
    recordId,
    type,
    createdBy: 'user_a',
    citations: [{ url: options.url, captureId: options.captureId, quote: 'the words on the page' }],
    claims: Object.entries(body).map(([path, value]) => ({ path, value, decision: options.decision ?? null })),
  }
}

const capture = (captureId: string, url: string): CaptureView => ({
  captureId,
  changeRequestId: 'cr',
  basis: 'fetched',
  sourceId: null,
  sourceOrigin: null,
  countsAsFetched: true,
  url,
  finalUrl: null,
  contentType: 'text/html',
  sha256: 'x'.repeat(64),
  bytes: 1,
  textChars: 1,
  pages: null,
  note: null,
  retrievedAt: '2026-11-01T00:00:00Z',
})

const binding = (key: string, act: string, edition: string, validFrom: string, validTo: string | null, options: { url?: string; captureId?: string; decision?: Decision } = {}) =>
  revision('relation', `relation:${key}`, { relationType: 'makes_binding', mode: 'declared', fromId: act, fromType: 'work', toId: edition, toType: 'edition', provision: `${act} § 1`, validFrom, ...(validTo ? { validTo } : {}) }, options)

/** The synthetic country: XA with two regions, a model code in two editions, each region's act adopting it. */
const REVISIONS: RevisionView[] = [
  revision('territory', 'XA', { kind: 'country', name: 'Xanadu', parents: [{ id: 'XU', validFrom: '1995-01-01' }] }),
  revision('territory', 'XA-1', { kind: 'state', name: 'Nordland', parents: [{ id: 'XA' }] }),
  revision('territory', 'XA-2', { kind: 'state', name: 'Südland', parents: [{ id: 'XA' }] }),
  revision('work', 'work:ba-n', { kind: 'statute', title: 'Building Act Nordland', identifiers: { designation: 'BA-N', eli: 'https://gazette.xa.example/eli/n/1/' }, territoryIds: ['XA-1'] }),
  revision('work', 'work:to-n', { kind: 'ordinance', title: 'Technical Ordinance Nordland', identifiers: { designation: 'TO-N' }, territoryIds: ['XA-1'] }),
  revision('work', 'work:to-s', { kind: 'ordinance', title: 'Technical Ordinance Südland', identifiers: { designation: 'TO-S' }, territoryIds: ['XA-2'] }),
  revision('work', 'work:mc-2', { kind: 'model_code', title: 'Fire', identifiers: { designation: 'MC 2' }, territoryIds: ['XA'] }),
  revision('work', 'work:mc-10', { kind: 'model_code', title: 'Energy', identifiers: { designation: 'MC 10' }, territoryIds: ['XA'] }),
  revision('edition', 'edition:mc-2-2019', { workId: 'work:mc-2', label: 'Edition 2019', issuedOn: '2019-04-12' }),
  revision('edition', 'edition:mc-2-2023', { workId: 'work:mc-2', label: 'Edition 2023', issuedOn: '2023-05-25' }),
  revision('edition', 'edition:mc-10-2019', { workId: 'work:mc-10', label: 'Edition 2019', issuedOn: '2019-04-12' }),
  revision('manifestation', 'manifestation:mc-2-2023-text', { editionId: 'edition:mc-2-2023', form: 'text', language: 'en', corpusFile: 'mc-2-2023.pdf' }, { url: 'https://publisher.xa.example/mc-2-2023.pdf' }),
  // Nordland: one act adopts both codes in 2020; an amendment moves MC 2 to 2023 in 2024. It cites the gazette.
  binding('n-2-19', 'work:to-n', 'edition:mc-2-2019', '2020-01-01', '2024-03-01', { captureId: 'c-gazette', decision: 'accepted' }),
  binding('n-10-19', 'work:to-n', 'edition:mc-10-2019', '2020-01-01', null, { captureId: 'c-gazette', decision: 'accepted' }),
  binding('n-2-23', 'work:to-n', 'edition:mc-2-2023', '2024-03-01', null, { url: 'https://data.gazette.xa.example/lgbl/2024/9' }),
  // Südland cites only the publisher's overview of adoption dates, and one claim was rejected.
  binding('s-2-19', 'work:to-s', 'edition:mc-2-2019', '2021-06-01', null, { url: 'https://publisher.xa.example/adoption-dates', decision: 'rejected' }),
  revision('relation', 'relation:n-dev', { relationType: 'deviates_from', fromId: 'work:to-n', fromType: 'work', toId: 'edition:mc-2-2023', toType: 'edition', anchors: [{ to: 'pkt_2.2' }], provision: 'TO-N § 4', validFrom: '2024-03-01' }),
]
const CAPTURES = [capture('c-gazette', 'https://gazette.xa.example/lgbl/2020/1')]

describe('lawMapOf', () => {
  const map = lawMapOf('XA', REVISIONS, CAPTURES)

  it('builds the territory tree from the parent without dates', () => {
    expect(map.rootIds).toEqual(['XA'])
    expect(map.territories.get('XA')?.children).toEqual(['XA-1', 'XA-2'])
    expect(map.territories.get('XA')?.parentId).toBeNull()
  })

  it('groups one act on one day into one statement, its deviation with it', () => {
    expect(map.statements.map((statement) => [statement.territoryId, statement.actWorkId, statement.validFrom, statement.cells.length])).toEqual([
      ['XA-1', 'work:to-n', '2020-01-01', 2],
      ['XA-1', 'work:to-n', '2024-03-01', 1],
      ['XA-2', 'work:to-s', '2021-06-01', 1],
    ])
    expect(map.statements[1]?.deviations).toEqual([{ relationId: 'relation:n-dev', editionId: 'edition:mc-2-2023', provision: 'TO-N § 4', anchors: ['pkt_2.2'] }])
  })

  it('orders the columns by designation, naturally', () => {
    expect(map.topics.map((topic) => topic.designation)).toEqual(['MC 2', 'MC 10'])
  })

  it('tells a citation of the region’s own legal host from a pointer elsewhere', () => {
    expect(map.statements.map((statement) => statement.sourceKind)).toEqual(['primary', 'primary', 'secondary'])
  })

  it('reads the review state from the claims', () => {
    expect(map.statements.map((statement) => statement.review)).toEqual(['accepted', 'open', 'rejected'])
    expect(reviewCounts(map, 'XA')).toEqual({ accepted: 1, open: 1, rejected: 1 })
    expect(reviewCounts(map, 'XA-2')).toEqual({ accepted: 0, open: 0, rejected: 1 })
  })

  it('lists the building act as the region’s statute, not as a column', () => {
    expect(map.statutes).toEqual([{ workId: 'work:ba-n', territoryId: 'XA-1', title: 'Building Act Nordland', designation: 'BA-N', url: 'https://gazette.xa.example/eli/n/1/', review: 'open' }])
  })

  it('finds what binds on a day, half-open', () => {
    expect(bindingOn(map, 'XA-1', 'work:mc-2', '2024-02-29')?.cell.editionId).toBe('edition:mc-2-2019')
    expect(bindingOn(map, 'XA-1', 'work:mc-2', '2024-03-01')?.cell.editionId).toBe('edition:mc-2-2023')
    expect(bindingOn(map, 'XA-2', 'work:mc-10', '2026-01-01')).toBeNull()
  })

  it('falls back to the topmost regions when the request holds no country record', () => {
    const regions = lawMapOf('XA', REVISIONS.filter((one) => one.recordId !== 'XA'), CAPTURES)
    expect(regions.rootIds).toEqual(['XA-1', 'XA-2'])
  })

  it('says a region’s editions once, with the exceptions, and what comes next', () => {
    const now = summaryOn(map, 'XA-1', '2025-01-01')
    // A tie goes to the first topic's edition; the other is the exception.
    expect(now.main?.label).toBe('Edition 2023')
    expect(now.exceptions.map(({ topic, edition }) => [topic.designation, edition.label])).toEqual([['MC 10', 'Edition 2019']])
    expect(nextChange(map, 'XA-1', '2023-01-01')?.validFrom).toBe('2024-03-01')
    expect(nextChange(map, 'XA-1', '2025-01-01')).toBeNull()
  })

  it('carries an edition’s text from its manifestation', () => {
    expect(map.editions.get('edition:mc-2-2023')?.text).toEqual({ file: 'mc-2-2023.pdf', url: 'https://publisher.xa.example/mc-2-2023.pdf' })
    expect(map.editions.get('edition:mc-2-2019')?.text).toBeNull()
  })

  it('does not count an edited claim as confirmed', () => {
    const edited = REVISIONS.map((one) => (one.recordId === 'relation:n-2-19' ? { ...one, claims: one.claims.map((claim) => ({ ...claim, decision: 'edited' as const })) } : one))
    expect(lawMapOf('XA', edited, CAPTURES).statements[0]?.review).toBe('open')
  })

  it('places a region whose only parent is dated under that parent', () => {
    const dated = REVISIONS.map((one) => (one.recordId === 'XA-2' ? revision('territory', 'XA-2', { kind: 'state', name: 'Südland', parents: [{ id: 'XA', validFrom: '2001-01-01' }] }) : one))
    expect(lawMapOf('XA', dated, CAPTURES).territories.get('XA')?.children).toEqual(['XA-1', 'XA-2'])
  })

  it('prefers the newest binding where an older one was left open', () => {
    const open = REVISIONS.map((one) => (one.recordId === 'relation:n-2-19' ? binding('n-2-19', 'work:to-n', 'edition:mc-2-2019', '2020-01-01', null) : one))
    expect(bindingOn(lawMapOf('XA', open, CAPTURES), 'XA-1', 'work:mc-2', '2025-01-01')?.cell.editionId).toBe('edition:mc-2-2023')
  })
})
