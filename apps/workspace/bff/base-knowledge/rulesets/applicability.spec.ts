/**
 * @vitest-environment node
 *
 * Whether an edition applies to a project's buildings, by its own scope
 * (`appliesWhen`, ADR-0177): a boolean decision table run on the one evaluator
 * per building. The tables here are synthetic, shaped like a guideline written
 * for production buildings and one written above an escape level; a country's
 * real scopes are records, each row citing its edition's scope clause.
 */

import { describe, expect, it } from 'vitest'
import { appliesWhenTableSchema } from '../wire/applies-when'
import { applicabilityOf, type BuildingInputs } from './applicability'

const PRODUCTION = appliesWhenTableSchema.parse({
  inputs: [{ key: 'uses', type: 'codes' }],
  output: { type: 'boolean' },
  rows: [
    { id: 'production', when: { in: ['production', { var: 'uses' }] }, then: true, provision: { citation: 'Synthetic guideline, scope clause' } },
    { id: 'no-production', when: { '!': { in: ['production', { var: 'uses' }] } }, then: false },
  ],
  otherwise: { then: false },
})

/** Above 22 m it applies; at or below, not, unless the building is agricultural: that falls to `otherwise`, left to a person. */
const HIGH = appliesWhenTableSchema.parse({
  inputs: [
    { key: 'uses', type: 'codes' },
    { key: 'escape_level_m', type: 'number' },
  ],
  output: { type: 'boolean' },
  rows: [
    { id: 'over-22', when: { '>': [{ var: 'escape_level_m' }, 22] }, then: true },
    {
      id: 'up-to-22',
      when: { and: [{ '<=': [{ var: 'escape_level_m' }, 22] }, { '!': { in: ['agriculture', { var: 'uses' }] } }] },
      then: false,
    },
  ],
  otherwise: { undetermined: true },
})

const building = (inputs: BuildingInputs['inputs'], buildingId = 'bldg1'): BuildingInputs => ({ buildingId, inputs })

describe('applicabilityOf', () => {
  it('applies to a production building, with the fact that decided it and the clause it cites', () => {
    expect(applicabilityOf(PRODUCTION, { buildings: [building({ uses: ['production'] })] })).toEqual({
      verdict: 'applies',
      basis: ['uses'],
      open: [],
      provision: 'Synthetic guideline, scope clause',
    })
  })

  it('does not apply to a block of flats', () => {
    expect(applicabilityOf(PRODUCTION, { buildings: [building({ uses: ['residential', 'garage'] })] })).toMatchObject({ verdict: 'not_applicable' })
  })

  it('asks for the fact that decides while it is open, and for every fact before any building is described', () => {
    expect(applicabilityOf(HIGH, { buildings: [building({ uses: ['residential'] })] })).toMatchObject({ verdict: 'check', open: ['escape_level_m'] })
    expect(applicabilityOf(PRODUCTION, { buildings: [] })).toMatchObject({ verdict: 'check', open: ['uses'], basis: [] })
  })

  it('leaves to a person what the scope itself leaves undetermined', () => {
    expect(applicabilityOf(HIGH, { buildings: [building({ uses: ['agriculture'], escape_level_m: 9 })] })).toMatchObject({ verdict: 'check', open: [] })
  })

  it('answers the strongest verdict any building gives: one production hall makes the project need it', () => {
    expect(applicabilityOf(PRODUCTION, { buildings: [building({ uses: ['residential'] }), building({ uses: ['production'] }, 'bldg2')] })).toMatchObject({
      verdict: 'applies',
    })
    expect(applicabilityOf(PRODUCTION, { buildings: [building({ uses: ['residential'] }), building({}, 'bldg2')] })).toMatchObject({ verdict: 'check' })
  })

  it('reads a scope the evaluator cannot run as a case to check, never as out of scope', () => {
    expect(applicabilityOf(HIGH, { buildings: [building({ escape_level_m: 'very high' as unknown as number, uses: ['office'] })] })).toMatchObject({
      verdict: 'check',
    })
  })
})

describe('the scope on the wire', () => {
  it('outputs a boolean, nothing else', () => {
    expect(appliesWhenTableSchema.safeParse({ ...PRODUCTION, output: { type: 'code', codes: ['applies'] }, rows: [], otherwise: { undetermined: true } }).success).toBe(false)
  })
})
