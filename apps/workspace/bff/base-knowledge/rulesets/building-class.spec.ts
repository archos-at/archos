/**
 * @vitest-environment node
 *
 * The parity harness of ADR-0169 for `derivations.ts`: the product classifies
 * an Austrian project's Building on the shipped records (the site selects the
 * OIB 2023 table and Austria's fact definitions, the one evaluator runs it), and
 * must give exactly what the retired coded derivation gives, kept as the
 * oracle (`derivations.oracle.ts`). First on the derivation's own cases
 * (`building-class.fixtures.ts`, one list for both), then on generated
 * Buildings: every input on a threshold, either side of it, or missing.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BUILDING_CLASS_CASES,
  multiFamilyHouse,
  singleFamilyHouse,
  type Inputs,
} from '@/lib/project-intake/building-class.fixtures'
import { BUILDING_CLASS_INPUTS, deriveBuildingClass } from '@/lib/project-intake/derivations.oracle'
import { deriveBuildingClass as classify } from '@/lib/project-intake/derivations'
import { buildingClassificationOf, setupScopeOf } from '@/lib/project-intake/setup-scope'
import { rulesetValuesSchema } from '@/lib/base-knowledge/wire/ruleset'
import seed from './seeds/at-oib-2023-building-class.json'
import { AT_OIB_2023_BUILDING_CLASS } from './building-class'
import { failingExamples } from './decision-table'

const fact = (value: string) => ({ value, confidence: 'confirmed' as const, source: 'onboarding' as const, updatedAt: '2026-11-10T00:00:00Z' })

/** What an Austrian project's site selects from the shipped records, through the product's own path. */
const AUSTRIA = buildingClassificationOf(setupScopeOf({ facts: { country: fact('at') }, assumptions: {} }))
if (!AUSTRIA) throw new Error('an Austrian project selects the OIB 2023 classification')
const AT_CLASSIFICATION = AUSTRIA

const buildingClassFromRuleset = (inputs: Inputs) => classify(AT_CLASSIFICATION, inputs)

describe('the OIB 2023 building class ruleset', () => {
  it('is what an Austrian site selects, in every Land', () => {
    expect(AT_CLASSIFICATION.rulesetId).toBe('shipped:at-oib-2023-building-class')
    const vienna = buildingClassificationOf(
      setupScopeOf({ facts: { country: fact('at'), federal_state: fact('vienna') }, assumptions: {} })
    )
    expect(vienna?.rulesetId).toBe('shipped:at-oib-2023-building-class')
  })

  it('is a valid ruleset whose own examples pass', () => {
    expect(rulesetValuesSchema.safeParse(seed).success).toBe(true)
    if (AT_OIB_2023_BUILDING_CLASS.body.kind !== 'table') throw new Error('a table')
    expect(failingExamples(AT_OIB_2023_BUILDING_CLASS.body.payload)).toEqual([])
  })

  it.each(BUILDING_CLASS_CASES)('%s, as the derivation says', (_name, inputs, expected) => {
    expect(buildingClassFromRuleset(inputs)).toEqual(expected)
  })

  it('holds „höchstens" at exactly 7, 11 and 22 m, 400 and 800 m², 3 and 4 storeys', () => {
    const low = (escape: number) =>
      buildingClassFromRuleset({
        ...multiFamilyHouse,
        gfa_above_ground: 300,
        escape_level_m: escape,
      }).value
    expect([low(7), low(7.01), low(11), low(11.01), low(22)]).toEqual([2, 4, 4, 5, 5])
    expect(buildingClassFromRuleset({ ...multiFamilyHouse, escape_level_m: 22.01 })).toMatchObject({
      hochhaus: true,
    })
    const area = (gfa: number, extra: Inputs = {}) =>
      buildingClassFromRuleset({ ...singleFamilyHouse, gfa_above_ground: gfa, ...extra }).value
    expect([area(400), area(400.5), area(800), area(800.5)]).toEqual([1, 2, 2, 3])
    expect(area(600, { uses: ['residential', 'garage'] })).toBe(3)
    const storeys = (count: number) =>
      buildingClassFromRuleset({
        ...singleFamilyHouse,
        escape_level_m: 6,
        storeys_above_ground: count,
      }).value
    expect([storeys(3), storeys(4), storeys(5)]).toEqual([1, 4, 5])
  })

  it('reads the profile as the derivation does: yes/no tokens, numeric strings, a single use', () => {
    const asStored = {
      ...singleFamilyHouse,
      access_three_sides: 'yes',
      storeys_above_ground: '2',
      uses: 'residential',
    }
    expect(buildingClassFromRuleset(asStored)).toEqual(deriveBuildingClass(asStored))
    const open = { ...singleFamilyHouse, access_three_sides: 'open' }
    expect(buildingClassFromRuleset(open)).toEqual(deriveBuildingClass(open))
  })

  /**
   * Each input on its thresholds and just past them, as stored or missing. The
   * derivation decides by enumerating every completion of the missing inputs;
   * the ruleset by Kleene's logic, row by row. Agreement on the class, on
   * Hochhaus and applicability, and on exactly which inputs are missing.
   */
  it('agrees with the coded derivation on generated Buildings, missing inputs included', () => {
    const maybe = <T>(arbitrary: fc.Arbitrary<T>) =>
      fc.option(arbitrary, { nil: undefined, freq: 3 })
    const building = fc.record({
      building_type: maybe(fc.constantFrom('building', 'small', 'other')),
      building_position: maybe(fc.constantFrom('freestanding', 'attached', 'terraced')),
      access_three_sides: maybe(
        fc.constantFrom<string | boolean>(true, false, 'yes', 'no', 'open')
      ),
      storeys_above_ground: maybe(fc.constantFrom(1, 3, 4, 5, 9)),
      escape_level_m: maybe(fc.constantFrom(2, 7, 7.01, 11, 11.01, 22, 22.01, 40)),
      gfa_above_ground: maybe(fc.constantFrom(90, 400, 400.5, 800, 800.5, 3000)),
      use_units: maybe(fc.constantFrom(0, 1, 2, 3, 20)),
      units_over_400: maybe(fc.boolean()),
      uses: maybe(
        fc.constantFrom<string[]>(['residential'], ['residential', 'garage'], ['office'], [])
      ),
    })
    fc.assert(
      fc.property(building, (inputs) => {
        expect(buildingClassFromRuleset(inputs), JSON.stringify(inputs)).toEqual(
          deriveBuildingClass(inputs)
        )
      }),
      { numRuns: 3000, seed: 20261110 }
    )
  })

  it('reads a list of uses holding anything but tokens as unknown, never as rein Wohnen', () => {
    // Outside the profile's type (a string list); the derivation reads it as not residential.
    const odd = {
      ...singleFamilyHouse,
      gfa_above_ground: 600,
      use_units: 3,
      uses: [['residential']],
    }
    expect(buildingClassFromRuleset(odd as unknown as Inputs)).toEqual({
      value: null,
      hochhaus: false,
      applicable: true,
      missing: ['uses'],
    })
  })

  it('lists the missing inputs in the derivation’s order', () => {
    expect(buildingClassFromRuleset({}).missing).toEqual([...BUILDING_CLASS_INPUTS])
  })
})
