/**
 * @vitest-environment node
 *
 * The validation kit (`validate.ts`): a proposal that names nothing it may
 * name, lies outside its request's country, or cites what was never captured,
 * is caught before it is written, with a problem pointing at the field.
 */
import { describe, expect, it } from 'vitest'
import { proposedRecordSchema } from './wire'
import { type DatedPlatformEdition, type KnownCapture, type KnownRecord, type Problem, validateProposal } from './validate'

const CAPTURE = '6f0c1a7e-2b7d-4c55-9a3e-6d1f0b2a9c11'
const UPLOAD = '7a1d2b8f-3c8e-4d66-8b4f-7e2a1c3b0d22'
const PAGE = 'MA 37 – Baupolizei. Die Magistratsabteilung 37 ist die Baubehörde erster Instanz für Wien.'
const CAPTURES = new Map<string, KnownCapture>([
  [CAPTURE, { text: PAGE, basis: 'fetched' }],
  [UPLOAD, { text: null, basis: 'operator_supplied' }],
])
const cited = (quote = 'MA 37 – Baupolizei') => [{ captureId: CAPTURE, quote }]

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

/** The kit's checks other than KC-6, for records proposed without citations: what the tests below are about. */
function kit(records: ReturnType<typeof parse>, country: string, known: ReadonlyMap<string, KnownRecord>, existing: DatedPlatformEdition[] = []): Problem[] {
  return validateProposal(records, country, known, CAPTURES, existing).filter((problem) => problem.code !== 'KC-6')
}

describe('validateProposal', () => {
  it('accepts an authority whose territories exist and whose quote is in its capture (positive control)', () => {
    expect(validateProposal(parse([ma37()]), 'AT', KNOWN, CAPTURES)).toEqual([])
  })

  it('names a seat territory that is not imported, and a territory outside the request’s country, by pointer', () => {
    const records = parse([
      ma37({ seatTerritoryId: 'AT-8' }),
      { type: 'territory', id: 'DE-BY', kind: 'state', name: 'Bayern', parentIds: ['AT'], citations: cited() },
    ])
    const found = validateProposal(records, 'AT', KNOWN, CAPTURES).map((p) => `${p.code} ${p.index} ${p.pointer}: ${p.detail}`)
    expect(found).toContainEqual(expect.stringContaining('KC-1 0 /seatTerritoryId: names territory AT-8'))
    expect(found).toContainEqual(expect.stringContaining('KC-1 1 /id: DE-BY lies outside AT'))
  })

  it('refuses an edition of a work that is neither on the platform nor in the batch, and an inverted interval', () => {
    const records = parse([{ type: 'edition', key: 'e1', workKey: 'nowhere', label: '2020', inForceFrom: '2021-01-01', inForceTo: '2020-01-01' }])
    expect(kit(records, 'AT', KNOWN).map((problem) => problem.code).sort()).toEqual(['KC-1', 'KC-3'])
  })

  it('keeps a record’s type and its country', () => {
    const records = parse([{ type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parentIds: ['AT'] }])
    const known = new Map<string, KnownRecord>([...KNOWN, ['AT-9', { type: 'territory', countryId: 'DE' }]])
    expect(kit(records, 'AT', known)).toContainEqual(expect.objectContaining({ detail: expect.stringContaining('belongs to DE') }))
  })

  describe('KC-6: a quote is checked against its capture, whoever proposed it', () => {
    const kc6 = (record: Record<string, unknown>) =>
      validateProposal(parse([record]), 'AT', KNOWN, CAPTURES).filter((problem) => problem.code === 'KC-6').map((problem) => problem.pointer)

    it('refuses a record that cites no capture, or only a bare link', () => {
      expect(kc6(ma37({ citations: [] }))).toEqual(['/citations'])
      expect(kc6(ma37({ citations: [{ url: 'https://www.wien.gv.at/ma37' }] }))).toEqual(['/citations', '/citations/0/url'])
    })

    it('refuses a quote the capture does not hold: a made-up page proves nothing', () => {
      expect(kc6(ma37({ citations: cited('MA 37 – Bauamt Graz') }))).toEqual(['/citations/0/quote'])
    })

    it('refuses a quote too short to show anything: "Wi" is in "Wien"', () => {
      expect(kc6(ma37({ citations: cited('MA 37') }))).toEqual(['/citations/0/quote'])
      expect(kc6({ type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parentIds: ['AT'], citations: cited('Wi') })).toContain('/citations/0/quote')
    })

    it('refuses quotes that never name what the record claims to be', () => {
      expect(kc6(ma37({ citations: cited('Baubehörde erster Instanz für Wien') }))).toEqual(['/citations'])
    })

    it('refuses a capture of another request, a citation without a quote, and a capture without text', () => {
      expect(kc6(ma37({ citations: [{ captureId: '00000000-0000-4000-8000-000000000000', quote: 'MA 37 – Baupolizei' }] }))).toEqual([
        '/citations/0/captureId',
      ])
      expect(kc6(ma37({ citations: [{ captureId: CAPTURE }] }))).toEqual(['/citations/0/quote'])
      expect(kc6(ma37({ citations: [{ captureId: UPLOAD, quote: 'MA 37 – Baupolizei' }] }))).toEqual(['/citations/0/captureId'])
    })

    it('finds a compound a PDF hyphenated across a line, and still not the compound with a word changed', () => {
      // As the BauNVO's PDF has it (page 6): the line ends at "Bundes-", the next begins "Immissionsschutzgesetzes".
      const pdf = 'im Sinne des § 3 des Bundes-\nImmissionsschutzgesetzes sowie Auswirkungen'
      const capture = new Map<string, KnownCapture>([[CAPTURE, { text: `MA 37 – Baupolizei. ${pdf}`, basis: 'fetched' }]])
      const check = (quote: string) =>
        validateProposal(parse([ma37({ citations: [...cited(), ...cited(quote)] })]), 'AT', KNOWN, capture)
          .filter((problem) => problem.code === 'KC-6')
          .map((problem) => problem.pointer)
      expect(check('im Sinne des § 3 des Bundes-Immissionsschutzgesetzes')).toEqual([])
      expect(check('im Sinne des § 3 des Landes-Immissionsschutzgesetzes')).toEqual(['/citations/1/quote'])
    })

    it('finds a quote across line breaks, typographic dashes and case, and nothing paraphrased', () => {
      expect(kc6(ma37({ citations: cited('ma 37 - baupolizei.') }))).toEqual([])
      expect(kc6(ma37({ citations: [...cited(), ...cited('Baubehörde erster\n  Instanz für Wien')] }))).toEqual([])
      expect(kc6(ma37({ citations: [...cited(), ...cited('Baubehörde erster Instanz in Wien')] }))).toEqual(['/citations/1/quote'])
    })

    it('holds a ruleset to it too: no capture, no ruleset', () => {
      const ruleset = {
        type: 'ruleset',
        key: 'at-9-reference-date',
        values: {
          purpose: 'reference_date',
          territoryIds: ['AT-9'],
          validFrom: '2000-01-01',
          body: {
            kind: 'table',
            payloadSchema: 'decision_table.v1',
            payload: { inputs: [{ key: 'filed_on', type: 'date' }], output: { type: 'event', events: ['filed_on'] }, rows: [], otherwise: { undetermined: true } },
          },
        },
      }
      expect(kc6(ruleset)).toEqual(['/citations'])
      expect(kc6({ ...ruleset, citations: cited() })).toEqual([])
    })

    it('gives each problem as an RFC 9457 member with a type per check and a hint', () => {
      const [problem] = validateProposal(parse([ma37({ citations: [] })]), 'AT', KNOWN, CAPTURES)
      expect(problem).toMatchObject({ type: 'urn:problem-type:knowledge-check:kc-6', code: 'KC-6', recordId: 'authority:ma37', index: 0 })
      expect(problem?.hint).toContain('platform-knowledge-citation-capture')
    })
  })
  const work = {
    type: 'work',
    key: 'wien-bo',
    kind: 'statute',
    title: 'Bauordnung für Wien',
    territoryIds: ['AT-9'],
  }
  const referenceRule = (examples: unknown[]) => ({
    type: 'ruleset',
    key: 'at-9-reference-date',
    values: {
      purpose: 'reference_date',
      territoryIds: ['AT-9'],
      workIds: ['work:wien-bo'],
      validFrom: '2000-01-01',
      body: {
        kind: 'table',
        payloadSchema: 'decision_table.v1',
        payload: {
          inputs: [{ key: 'filed_on', type: 'date' }],
          output: { type: 'event', events: ['filed_on'] },
          rows: [
            { id: 'filed', when: { '<=': ['0000-01-01', { var: 'filed_on' }] }, then: 'filed_on' },
          ],
          otherwise: { undetermined: true },
          examples,
        },
      },
    },
  })

  it('accepts a reference-date ruleset for a work in the batch whose examples hold (positive control)', () => {
    const records = parse([
      work,
      referenceRule([{ facts: { filed_on: '2023-01-01' }, expect: { then: 'filed_on' } }]),
    ])
    expect(kit(records, 'AT', KNOWN)).toEqual([])
  })

  it('KC-5: refuses a ruleset whose own example does not hold, and KC-1 a work it names that does not exist', () => {
    const records = parse([referenceRule([{ facts: {}, expect: { then: 'filed_on' } }])])
    expect(
      kit(records, 'AT', KNOWN)
        .map((problem) => problem.code)
        .sort()
    ).toEqual(['KC-1', 'KC-5'])
  })

  it('KC-3: refuses two editions of one work in force on the same day, and accepts them back to back', () => {
    const edition = (key: string, inForceFrom: string, inForceTo: string | null) => ({
      type: 'edition',
      key,
      workKey: 'wien-bo',
      label: key,
      inForceFrom,
      inForceTo,
    })
    const backToBack = parse([
      work,
      edition('e2018', '2018-09-01', '2023-12-31'),
      edition('e2024', '2024-01-01', null),
    ])
    expect(kit(backToBack, 'AT', KNOWN)).toEqual([])
    const overlapping = parse([
      work,
      edition('e2018', '2018-09-01', '2024-01-01'),
      edition('e2024', '2024-01-01', null),
    ])
    expect(kit(overlapping, 'AT', KNOWN)).toEqual([
      expect.objectContaining({ code: 'KC-3', key: 'e2018' }),
    ])
  })

  it('refuses a transition whose output is not old_law, new_law or choice when it is proposed', () => {
    const result = proposedRecordSchema.safeParse({
      type: 'edition',
      key: 'e2024',
      workKey: 'wien-bo',
      label: '2024',
      transition: {
        inputs: [{ key: 'filed_on', type: 'date' }],
        output: { type: 'boolean' },
        rows: [],
        otherwise: { then: true },
      },
    })
    expect(result.success).toBe(false)
  })

  it('KC-3: refuses a new edition overlapping one already on the platform, unless the batch closes the old one', () => {
    const known = new Map<string, KnownRecord>([...KNOWN, ['work:wien-bo', { type: 'work', countryId: 'AT' }]])
    const published = [{ id: 'edition:e2018', workId: 'work:wien-bo', inForceFrom: '2018-09-01', inForceTo: null }]
    const edition = (key: string, inForceFrom: string, inForceTo: string | null) => ({ type: 'edition', key, workKey: 'wien-bo', label: key, inForceFrom, inForceTo })
    const alone = parse([edition('e2024', '2024-01-01', null)])
    expect(kit(alone, 'AT', known, published)).toEqual([
      expect.objectContaining({ code: 'KC-3', key: 'e2024', detail: expect.stringContaining('edition:e2018') }),
    ])
    const closing = parse([edition('e2018', '2018-09-01', '2023-12-31'), edition('e2024', '2024-01-01', null)])
    expect(kit(closing, 'AT', known, published)).toEqual([])
    // An edition of another work does not count.
    expect(kit(alone, 'AT', known, [{ ...published[0], workId: 'work:other' }])).toEqual([])
  })
})
