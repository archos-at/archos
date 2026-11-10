/**
 * @vitest-environment node
 *
 * The validation kit (`validate.ts`): a proposal that names nothing it may
 * name, lies outside its request's country, or cites what was never captured,
 * is caught before it is written, with a problem pointing at the field.
 */
import { describe, expect, it } from 'vitest'
import { proposedRecordSchema } from './wire'
import { type KnownCapture, type KnownRecord, validateProposal } from './validate'

const CAPTURE = '6f0c1a7e-2b7d-4c55-9a3e-6d1f0b2a9c11'
const UPLOAD = '7a1d2b8f-3c8e-4d66-8b4f-7e2a1c3b0d22'
const PAGE = 'Magistratsabteilung 37 – Baupolizei. Die Baubehörde erster Instanz für Wien.'
const CAPTURES = new Map<string, KnownCapture>([
  [CAPTURE, { text: PAGE, basis: 'fetched' }],
  [UPLOAD, { text: null, basis: 'operator_supplied' }],
])
const cited = (quote = 'Magistratsabteilung 37') => [{ captureId: CAPTURE, quote }]

const parse = (records: unknown[]) => records.map((record) => proposedRecordSchema.parse(record))
const KNOWN = new Map<string, KnownRecord>([
  ['AT', { type: 'territory', countryId: 'AT' }],
  ['AT-9', { type: 'territory', countryId: 'AT' }],
])
const ma37 = (extra: Record<string, unknown> = {}) => ({
  type: 'authority',
  key: 'ma37',
  name: 'MA 37',
  seatTerritoryId: 'AT-9',
  competenceTerritoryIds: ['AT-9'],
  citations: cited(),
  ...extra,
})

describe('validateProposal', () => {
  it('accepts an authority whose territories exist and whose quote is in its capture (positive control)', () => {
    expect(validateProposal(parse([ma37()]), 'AT', KNOWN, CAPTURES)).toEqual([])
  })

  it('names a seat territory that is not imported, and a territory outside the request’s country, by pointer', () => {
    const records = parse([
      ma37({ seatTerritoryId: 'AT-8' }),
      { type: 'territory', id: 'DE-BY', kind: 'state', name: 'Bayern', parentIds: ['AT'], citations: cited('Wien') },
    ])
    const found = validateProposal(records, 'AT', KNOWN, CAPTURES).map((p) => `${p.code} ${p.index} ${p.pointer}: ${p.detail}`)
    expect(found).toContainEqual(expect.stringContaining('KC-1 0 /seatTerritoryId: names territory AT-8'))
    expect(found).toContainEqual(expect.stringContaining('KC-1 1 /id: DE-BY lies outside AT'))
  })

  it('refuses an edition of a work that is neither on the platform nor in the batch, and an inverted interval', () => {
    const records = parse([
      { type: 'edition', key: 'e1', workKey: 'nowhere', label: '2020', inForceFrom: '2021-01-01', inForceTo: '2020-01-01', citations: cited() },
    ])
    expect(validateProposal(records, 'AT', KNOWN, CAPTURES).map((problem) => problem.code).sort()).toEqual(['KC-1', 'KC-3'])
  })

  it('keeps a record’s type and its country', () => {
    const records = parse([{ type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parentIds: ['AT'], citations: cited('Wien') }])
    const known = new Map<string, KnownRecord>([...KNOWN, ['AT-9', { type: 'territory', countryId: 'DE' }]])
    expect(validateProposal(records, 'AT', known, CAPTURES)).toContainEqual(expect.objectContaining({ detail: expect.stringContaining('belongs to DE') }))
  })

  describe('KC-6: a quote is checked against its capture, whoever proposed it', () => {
    const kc6 = (record: Record<string, unknown>) =>
      validateProposal(parse([record]), 'AT', KNOWN, CAPTURES).filter((problem) => problem.code === 'KC-6').map((problem) => problem.pointer)

    it('refuses a record that cites no capture, or only a bare link', () => {
      expect(kc6(ma37({ citations: [] }))).toEqual(['/citations'])
      expect(kc6(ma37({ citations: [{ url: 'https://www.wien.gv.at/ma37' }] }))).toEqual(['/citations', '/citations/0/url'])
    })

    it('refuses a quote the capture does not hold: a made-up page proves nothing', () => {
      expect(kc6(ma37({ citations: cited('Magistratsabteilung 38') }))).toEqual(['/citations/0/quote'])
    })

    it('refuses a capture of another request, a citation without a quote, and a capture without text', () => {
      expect(kc6(ma37({ citations: [{ captureId: '00000000-0000-4000-8000-000000000000', quote: 'MA 37' }] }))).toEqual(['/citations/0/captureId'])
      expect(kc6(ma37({ citations: [{ captureId: CAPTURE }] }))).toEqual(['/citations/0/quote'])
      expect(kc6(ma37({ citations: [{ captureId: UPLOAD, quote: 'MA 37' }] }))).toEqual(['/citations/0/captureId'])
    })

    it('finds a quote across line breaks, typographic dashes and case, and nothing paraphrased', () => {
      expect(kc6(ma37({ citations: cited('magistratsabteilung 37 - baupolizei.') }))).toEqual([])
      expect(kc6(ma37({ citations: cited('Baubehörde erster\n  Instanz für Wien') }))).toEqual([])
      expect(kc6(ma37({ citations: cited('Baubehörde erster Instanz in Wien') }))).toEqual(['/citations/0/quote'])
    })

    it('gives each problem as an RFC 9457 member with a type per check and a hint', () => {
      const [problem] = validateProposal(parse([ma37({ citations: [] })]), 'AT', KNOWN, CAPTURES)
      expect(problem).toMatchObject({ type: 'urn:problem-type:knowledge-check:kc-6', code: 'KC-6', recordId: 'authority:ma37', index: 0 })
      expect(problem?.hint).toContain('platform-knowledge-citation-capture')
    })
  })
})
