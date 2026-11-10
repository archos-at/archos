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
      { type: 'authority', key: 'ma37', name: 'MA 37', seatTerritoryId: 'AT-9', competenceTerritoryIds: ['AT-9'] },
    ])
    expect(validateProposal(records, 'AT', KNOWN)).toEqual([])
  })

  it('names a seat or competence territory that is not imported, and a territory outside the request’s country', () => {
    const records = parse([
      { type: 'authority', key: 'ma37', name: 'MA 37', seatTerritoryId: 'AT-8', competenceTerritoryIds: ['AT-9'] },
      { type: 'territory', id: 'DE-BY', kind: 'state', name: 'Bayern', parentIds: ['AT'] },
    ])
    const details = validateProposal(records, 'AT', KNOWN).map((problem) => `${problem.check} ${problem.key}: ${problem.detail}`)
    expect(details).toContainEqual(expect.stringContaining('KC-1 ma37: names territory AT-8'))
    expect(details).toContainEqual(expect.stringContaining('KC-1 DE-BY: DE-BY lies outside AT'))
  })

  it('refuses an edition of a work that is neither on the platform nor in the batch, and an inverted interval', () => {
    const records = parse([
      { type: 'edition', key: 'e1', workKey: 'nowhere', label: '2020', inForceFrom: '2021-01-01', inForceTo: '2020-01-01' },
    ])
    expect(validateProposal(records, 'AT', KNOWN).map((problem) => problem.check).sort()).toEqual(['KC-1', 'KC-3'])
  })

  it('keeps a record’s type and its country', () => {
    const records = parse([{ type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parentIds: ['AT'] }])
    const known = new Map<string, KnownRecord>([...KNOWN, ['AT-9', { type: 'territory', countryId: 'DE' }]])
    expect(validateProposal(records, 'AT', known)).toContainEqual(expect.objectContaining({ detail: expect.stringContaining('belongs to DE') }))
  })
})
