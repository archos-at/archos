/**
 * @vitest-environment node
 *
 * The outcome of ADR-0166 for Austria: the OIB 2023 Gebäudeklasse, held as a
 * ruleset and run on the one evaluator, gives what the coded derivation gives.
 * First on the derivation's own cases (`building-class.fixtures.ts`, one list for
 * both), then against `deriveBuildingClass` itself on generated Buildings:
 * every input on a threshold, either side of it, or missing.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BUILDING_CLASS_CASES,
  multiFamilyHouse,
  singleFamilyHouse,
  type Inputs,
} from '@/lib/project-intake/building-class.fixtures'
import { BUILDING_CLASS_INPUTS, deriveBuildingClass } from '@/lib/project-intake/derivations'
import { rulesetValuesSchema } from '@/lib/base-knowledge/wire/ruleset'
import seed from './seeds/at-oib-2023-building-class.json'
import { AT_OIB_2023_BUILDING_CLASS, buildingClassFromRuleset } from './building-class'
import { failingExamples } from './decision-table'

describe('the OIB 2023 building class ruleset', () => {
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

  it('lists the missing inputs in the derivation’s order', () => {
    expect(buildingClassFromRuleset({}).missing).toEqual([...BUILDING_CLASS_INPUTS])
  })
})
