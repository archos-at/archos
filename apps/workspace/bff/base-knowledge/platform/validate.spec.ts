/**
 * @vitest-environment node
 *
 * The validation kit's first checks (`validate.ts`): a proposal that names
 * nothing it may name, or lies outside its request's country, is caught
 * before it is written.
 */
import { describe, expect, it } from 'vitest'
import { proposedRecordSchema } from './wire'
import { validateProposal, type KnownRecord } from './validate'

const parse = (records: unknown[]) => records.map((record) => proposedRecordSchema.parse(record))
const KNOWN = new Map<string, KnownRecord>([
  ['AT', { type: 'territory', countryId: 'AT' }],
  ['AT-9', { type: 'territory', countryId: 'AT' }],
])

describe('validateProposal', () => {
  it('accepts an authority whose seat and competence territories exist (positive control)', () => {
    const records = parse([
      {
        type: 'authority',
        key: 'ma37',
        name: 'MA 37',
        seatTerritoryId: 'AT-9',
        competenceTerritoryIds: ['AT-9'],
      },
    ])
    expect(validateProposal(records, 'AT', KNOWN)).toEqual([])
  })

  it('names a seat or competence territory that is not imported, and a territory outside the request’s country', () => {
    const records = parse([
      {
        type: 'authority',
        key: 'ma37',
        name: 'MA 37',
        seatTerritoryId: 'AT-8',
        competenceTerritoryIds: ['AT-9'],
      },
      { type: 'territory', id: 'DE-BY', kind: 'state', name: 'Bayern', parentIds: ['AT'] },
    ])
    const details = validateProposal(records, 'AT', KNOWN).map(
      (problem) => `${problem.check} ${problem.key}: ${problem.detail}`
    )
    expect(details).toContainEqual(expect.stringContaining('KC-1 ma37: names territory AT-8'))
    expect(details).toContainEqual(expect.stringContaining('KC-1 DE-BY: DE-BY lies outside AT'))
  })

  it('refuses an edition of a work that is neither on the platform nor in the batch, and an inverted interval', () => {
    const records = parse([
      {
        type: 'edition',
        key: 'e1',
        workKey: 'nowhere',
        label: '2020',
        inForceFrom: '2021-01-01',
        inForceTo: '2020-01-01',
      },
    ])
    expect(
      validateProposal(records, 'AT', KNOWN)
        .map((problem) => problem.check)
        .sort()
    ).toEqual(['KC-1', 'KC-3'])
  })

  it('keeps a record’s type and its country', () => {
    const records = parse([
      { type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parentIds: ['AT'] },
    ])
    const known = new Map<string, KnownRecord>([
      ...KNOWN,
      ['AT-9', { type: 'territory', countryId: 'DE' }],
    ])
    expect(validateProposal(records, 'AT', known)).toContainEqual(
      expect.objectContaining({ detail: expect.stringContaining('belongs to DE') })
    )
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
    expect(validateProposal(records, 'AT', KNOWN)).toEqual([])
  })

  it('KC-5: refuses a ruleset whose own example does not hold, and KC-1 a work it names that does not exist', () => {
    const records = parse([referenceRule([{ facts: {}, expect: { then: 'filed_on' } }])])
    expect(
      validateProposal(records, 'AT', KNOWN)
        .map((problem) => problem.check)
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
    expect(validateProposal(backToBack, 'AT', KNOWN)).toEqual([])
    const overlapping = parse([
      work,
      edition('e2018', '2018-09-01', '2024-01-01'),
      edition('e2024', '2024-01-01', null),
    ])
    expect(validateProposal(overlapping, 'AT', KNOWN)).toEqual([
      expect.objectContaining({ check: 'KC-3', key: 'e2024' }),
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
})
