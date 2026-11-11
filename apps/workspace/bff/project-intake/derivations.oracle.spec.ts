/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { flattenIntakeQuestions } from '@/lib/project-profile/intake-conditions'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import {
  BUILDING_CLASS_CASES,
  building,
  multiFamilyHouse,
  singleFamilyHouse,
  type Inputs,
} from './building-class.fixtures'
import {
  decisiveInputs,
  deriveBuildingClass,
  BUILDING_CLASS_DERIVATION,
  BUILDING_CLASS_INPUTS,
  possibleBuildingClasses,
} from './derivations.oracle'

describe('deriveGebaeudeklasse', () => {
  it.each(BUILDING_CLASS_CASES)('%s', (_name, inputs, expected) => {
    expect(deriveBuildingClass(inputs)).toEqual(expected)
  })

  it('reads the values as the wizard and the profile store them', () => {
    expect(
      deriveBuildingClass({
        ...singleFamilyHouse,
        access_three_sides: 'yes',
        storeys_above_ground: '2',
        escape_level_m: '3.2',
      }).value
    ).toBe(1)
    // `offen` is no answer: GK 1 or GK 2 is then open on the access alone.
    expect(deriveBuildingClass({ ...singleFamilyHouse, access_three_sides: 'open' })).toEqual({
      value: null,
      hochhaus: false,
      applicable: true,
      missing: ['access_three_sides'],
    })
  })

  it('needs the Bauwerkstyp before it names a class', () => {
    expect(deriveBuildingClass({ ...singleFamilyHouse, building_type: undefined })).toEqual({
      value: null,
      hochhaus: false,
      applicable: true,
      missing: ['building_type'],
    })
  })
})

describe('boundaries', () => {
  const low = (escape_level_m: number, extra: Inputs = {}) =>
    deriveBuildingClass({ ...multiFamilyHouse, gfa_above_ground: 300, escape_level_m, ...extra }).value

  it('holds „höchstens" at exactly 7, 11 and 22 m', () => {
    expect(low(7)).toBe(2) // 6 units: not GK 1; 300 m² ≤ 400 m²: GK 2
    expect(low(7.01)).toBe(4) // 3 oG, ≤ 11 m, no unit above 400 m²
    expect(low(11)).toBe(4)
    expect(low(11.01)).toBe(5)
    expect(low(22)).toBe(5)
    expect(deriveBuildingClass({ ...multiFamilyHouse, escape_level_m: 22.01 })).toMatchObject({
      value: null,
      hochhaus: true,
    })
  })

  it('holds „höchstens" at exactly 400 and 800 m²', () => {
    const area = (gfa_above_ground: number, extra: Inputs = {}) =>
      deriveBuildingClass({ ...singleFamilyHouse, gfa_above_ground, ...extra }).value
    expect(area(400)).toBe(1)
    expect(area(400.5)).toBe(2) // freistehend, three sides, rein Wohnen, ≤ 800 m²
    expect(area(800)).toBe(2)
    expect(area(800.5)).toBe(3)
    // A garage in the house is no reines Wohngebäude: the 800 m² branch closes.
    expect(area(600, { uses: ['residential', 'garage'] })).toBe(3)
  })

  it('holds „höchstens" at exactly 3 and 4 oberirdische Geschoße', () => {
    const storeys = (storeys_above_ground: number) =>
      deriveBuildingClass({ ...singleFamilyHouse, escape_level_m: 6, storeys_above_ground }).value
    expect(storeys(3)).toBe(1)
    expect(storeys(4)).toBe(4) // one unit: GK 4 b)
    expect(storeys(5)).toBe(5)
  })

  it('counts the building with two units as GK 1 and with three as no longer', () => {
    expect(deriveBuildingClass({ ...singleFamilyHouse, use_units: 2 }).value).toBe(1)
    expect(deriveBuildingClass({ ...singleFamilyHouse, use_units: 3 }).value).toBe(2)
  })
})

describe('possibleGebaeudeklassen', () => {
  it('lists what the building can still turn out to be', () => {
    const open = building({
      building_position: 'attached',
      storeys_above_ground: 2,
      gfa_above_ground: 300,
    })
    expect(possibleBuildingClasses(open)).toEqual(new Set([2, 4, 5, 'hochhaus']))
    expect(
      possibleBuildingClasses({ ...open, use_units: 2, units_over_400: false })
    ).toEqual(new Set([2, 4, 5, 'hochhaus']))
    expect(possibleBuildingClasses(singleFamilyHouse)).toEqual(new Set([1]))
    expect(possibleBuildingClasses({ building_type: 'other' })).toEqual(new Set())
  })
})

describe('decisiveInputs', () => {
  it('names an open input only when one of its bands can flip the outcome', () => {
    expect(decisiveInputs(building({ storeys_above_ground: 6, escape_level_m: 18 }))).toEqual([])
    expect(decisiveInputs(building({ escape_level_m: 25 }))).toEqual([])
    // Angebaut: the three-side access and the uses only matter for a freistehend building.
    expect(
      decisiveInputs(
        building({ building_position: 'attached', storeys_above_ground: 2, gfa_above_ground: 300 })
      )
    ).toEqual(['escape_level_m', 'use_units', 'units_over_400'])
  })

  it('names at least one input whenever more than one outcome is possible, and none otherwise', () => {
    const samples: Inputs[] = [
      {},
      building({}),
      building({ escape_level_m: 9 }),
      building({ storeys_above_ground: 2, escape_level_m: 5 }),
      { ...singleFamilyHouse, access_three_sides: undefined, use_units: undefined },
      { ...multiFamilyHouse, building_position: undefined },
      singleFamilyHouse,
      multiFamilyHouse,
    ]
    for (const inputs of samples) {
      const outcomes =
        possibleBuildingClasses(inputs).size + (inputs.building_type === undefined ? 1 : 0)
      expect(decisiveInputs(inputs).length > 0, JSON.stringify(inputs)).toBe(outcomes > 1)
    }
  })

  it('agrees with deriveBuildingClass’s missing', () => {
    const inputs = { ...multiFamilyHouse, building_position: undefined, uses: undefined }
    // A Reihenhaus of units ≤ 400 m² would be GK 2; any other Stellung leaves GK 3. The uses only
    // matter for the 800 m² branch, which 900 m² misses.
    expect(decisiveInputs(inputs)).toEqual(['building_position'])
    expect(deriveBuildingClass(inputs).missing).toEqual(['building_position'])
  })
})

describe('the definition', () => {
  it('cites the Begriffsbestimmungen it encodes', () => {
    expect(BUILDING_CLASS_DERIVATION.citation).toBe(
      'OIB-Richtlinien, Begriffsbestimmungen (Ausgabe Mai 2023), Gebäudeklassen'
    )
    expect(BUILDING_CLASS_DERIVATION.inputs).toEqual(BUILDING_CLASS_INPUTS)
  })

  it('reads only keys the wizard writes, and every question that feeds it is one of its inputs', () => {
    const questions = flattenIntakeQuestions(projectIntakeDefinitionV1)
    const written = new Set(
      questions.map((question) => question.writesTo?.match(/^\/facts\/([^/]+)/)?.[1])
    )
    for (const input of BUILDING_CLASS_INPUTS) expect(written.has(input), input).toBe(true)
    const inputs: readonly string[] = BUILDING_CLASS_INPUTS
    for (const question of questions.filter((item) => item.feeds === 'building_class')) {
      expect(inputs, question.id).toContain(question.writesTo?.match(/^\/facts\/([^/]+)/)?.[1])
    }
  })
})
