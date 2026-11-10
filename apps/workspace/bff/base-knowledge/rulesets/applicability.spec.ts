// @disk-inputs: ../../configs/knowledge-packs/at-applicability.json
/**
 * @vitest-environment node
 *
 * Whether a work applies to a project's buildings (ADR-0176), on Austria's
 * three tables as the pack proposes them: OIB-RL 2.1 for a Betriebsbau, 2.2
 * for a garage, 2.3 above an escape level of 22 m. What the removed OIB list
 * decided in code, decided here from records.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { proposeRecordsBodySchema } from '../platform/wire'
import { rulesetValuesSchema } from '../wire/ruleset'
import { applicabilityOf, type BuildingInputs } from './applicability'
import type { StoredRuleset } from './select'

const pack = JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', 'at-applicability.json'), 'utf8'))
const RULESETS: StoredRuleset[] = proposeRecordsBodySchema
  .parse({ records: pack.records })
  .records.flatMap((record) => (record.type === 'ruleset' ? [{ id: `ruleset:${record.key}`, values: record.values }] : []))

const VIENNA = ['AT-9', 'AT']
const ON = '2026-11-10'
const building = (inputs: BuildingInputs['inputs'], buildingId = 'bldg1'): BuildingInputs => ({ buildingId, inputs })
const of = (work: string, buildings: BuildingInputs[], chain = VIENNA) =>
  applicabilityOf(RULESETS, `work:${work}`, { chain, on: ON, buildings })

describe('applicabilityOf, on Austria’s tables', () => {
  it('names OIB-RL 2.1 for a Betriebsbau, with the fact that decided it and the provision', () => {
    expect(of('oib-rl-2-1', [building({ uses: ['production'] })])).toEqual({
      verdict: 'applies',
      basis: ['uses'],
      open: [],
      provision: 'OIB-Richtlinie 2.1 (Ausgabe Mai 2023), Brandschutz bei Betriebsbauten: Anwendungsbereich',
    })
  })

  it('excludes OIB-RL 2.1 for a block of flats, and names 2.2 for its garage', () => {
    const flats = [building({ uses: ['residential', 'garage'] })]
    expect(of('oib-rl-2-1', flats)).toMatchObject({ verdict: 'not_applicable', basis: [], open: [] })
    expect(of('oib-rl-2-2', flats)).toMatchObject({ verdict: 'applies', basis: ['uses'] })
  })

  it('leaves to a person whether a farm building is a Betriebsbau', () => {
    expect(of('oib-rl-2-1', [building({ uses: ['agriculture'] })])).toMatchObject({ verdict: 'check', basis: ['uses'], open: [] })
  })

  it('names OIB-RL 2.3 above an escape level of 22 m, and not at 22 m', () => {
    expect(of('oib-rl-2-3', [building({ escape_level_m: 25 })])).toMatchObject({ verdict: 'applies', basis: ['escape_level_m'] })
    expect(of('oib-rl-2-3', [building({ escape_level_m: 22 })])).toMatchObject({ verdict: 'not_applicable' })
  })

  it('asks for the fact that decides while it is open, and for every fact before any building is described', () => {
    expect(of('oib-rl-2-3', [building({ uses: ['residential'] })])).toMatchObject({ verdict: 'check', open: ['escape_level_m'] })
    expect(of('oib-rl-2-1', [])).toMatchObject({ verdict: 'check', open: ['uses'], basis: [] })
  })

  it('answers the strongest verdict any building gives: one production hall makes the project need 2.1', () => {
    const buildings = [building({ uses: ['residential'] }), building({ uses: ['production'] }, 'bldg2')]
    expect(of('oib-rl-2-1', buildings)).toMatchObject({ verdict: 'applies' })
    const open = [building({ uses: ['residential'] }), building({}, 'bldg2')]
    expect(of('oib-rl-2-1', open)).toMatchObject({ verdict: 'check', open: ['uses'] })
  })

  it('does not narrow a work no table speaks for, nor a site outside the tables’ territory', () => {
    expect(of('oib-rl-2', [building({ uses: ['residential'] })])).toBeNull()
    expect(of('oib-rl-2-1', [building({ uses: ['residential'] })], ['DE-BY', 'DE'])).toBeNull()
  })

  it('reads two tables for one work at one node as a data error to check, never as a guess', () => {
    const [first] = RULESETS
    const twin = { ...first, id: `${first.id}-twin` }
    expect(applicabilityOf([...RULESETS, twin], first.values.workIds[0], { chain: VIENNA, on: ON, buildings: [building({ uses: ['residential'] })] })).toMatchObject({
      verdict: 'check',
      basis: [],
      open: [],
    })
  })
})

describe('the applicability record', () => {
  const [first] = RULESETS
  it('names the works it speaks for', () => {
    expect(rulesetValuesSchema.safeParse({ ...first.values, workIds: [] }).success).toBe(false)
  })

  it('answers a verdict, nothing else', () => {
    if (first.values.body.kind !== 'table') throw new Error('a table')
    const body = { ...first.values.body, payload: { ...first.values.body.payload, output: { type: 'boolean' }, rows: [], otherwise: { then: true }, examples: [] } }
    expect(rulesetValuesSchema.safeParse({ ...first.values, body }).success).toBe(false)
  })
})
