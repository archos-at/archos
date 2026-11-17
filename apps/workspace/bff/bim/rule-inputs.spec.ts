// @disk-inputs: bff/bim/rule-values.ts, bff/bim/rules.ts
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RULE_INPUT_FIELDS,
  RULE_INPUT_KEYS,
  buildSearchKeys,
  buildStoredRuleInputs,
  projectRuleInputs,
  readStoredRuleInputs,
} from './rule-inputs'
import { SETTLED_BASES } from './rule-basis.fixtures'
import { runBimRules as runOnSite, type BimRuleFacts } from './rules'
import type { BimElement } from './types'

const runBimRules = (elements: readonly BimElement[], facts: Omit<BimRuleFacts, 'bases'>) =>
  runOnSite(elements, { bases: SETTLED_BASES, ...facts })

function element(overrides: Partial<BimElement> & Pick<BimElement, 'ifcType'>): BimElement {
  return {
    globalId: '2O2Fr$t4X7Zf8NOew3FLKU',
    expressId: 4211,
    name: 'Aussenwand Nord',
    description: 'ignoriert',
    predefinedType: 'SOLIDWALL',
    objectType: 'Basic Wall',
    tag: 'W-01',
    typeName: 'AW 38',
    storeyGlobalId: '0GridGeoStEG000000001',
    storeyName: 'Erdgeschoss',
    containerGlobalId: null,
    containerKind: 'storey',
    containerName: 'Erdgeschoss',
    materials: ['Stahlbeton'],
    classifications: [{ system: 'ÖNORM', identification: 'B.2.1', name: 'Außenwände' }],
    properties: {},
    quantities: {},
    ...overrides,
  }
}

const STOREYS = [
  { name: 'Keller', elevation: -2.8 },
  { name: 'Erdgeschoss', elevation: 0 },
  { name: 'Obergeschoss', elevation: 3 },
]

const MODEL: BimElement[] = [
  element({
    ifcType: 'IfcWall',
    properties: {
      Pset_WallCommon: {
        LoadBearing: true,
        FireRating: 'R 60',
        IsExternal: true,
        ThermalTransmittance: 0.21,
        AcousticRating: 53,
        Combustible: false,
        Reference: 'AW 38',
      },
      'Revit Type Parameters': { 'Type Mark': 'AW38', Cost: 0, Keynote: '' },
    },
    quantities: { Qto_WallBaseQuantities: { Length: 8.4, NetSideArea: 21.4, Width: 0.38 } },
  }),
  element({
    ifcType: 'IfcDoor',
    globalId: '1kTvXnbbzCWw8lcMd1dR4o',
    name: 'T-14',
    quantities: { Qto_DoorBaseQuantities: { Width: 0.7, Height: 2.1 } },
  }),
  element({
    ifcType: 'IfcSpace',
    globalId: '0RSwXnbbzCWw8lcMd1dR9z',
    name: 'Wohnzimmer',
    quantities: { Qto_SpaceBaseQuantities: { FinishCeilingHeight: 2.4, NetFloorArea: 32 } },
  }),
  element({
    ifcType: 'IfcStairFlight',
    globalId: '3aB9Kz1Uv7wxKQ8bqZ3aB2',
    name: 'Treppe Ost',
    properties: { Pset_StairFlightCommon: { RiserHeight: 0.18, TreadLength: 0.28 } },
  }),
  element({
    ifcType: 'IfcWindow',
    globalId: '4cD0Lz2Vw8xyLR9crA4bC3',
    name: 'F-01',
    properties: { Pset_WindowCommon: { ThermalTransmittance: 1.1 } },
  }),
]

const FACTS = { buildingClass: 4 as const, mainUse: 'residential', storeys: STOREYS }

describe('projected rule inputs', () => {
  it('produces exactly the verdicts the full elements produce', () => {
    const stored = readStoredRuleInputs(buildStoredRuleInputs(MODEL, false))

    expect(runBimRules(stored!.elements, FACTS)).toEqual(runBimRules(MODEL, FACTS))
  })

  it('covers every key the catalogue reads', () => {
    const source = ['rule-values.ts', 'rules.ts']
      .map((file) => readFileSync(join(process.cwd(), 'bff', 'bim', file), 'utf8'))
      .join('\n')
    const read = new Set(
      [...source.matchAll(/(?:dimensionProperty|numericProperty|property|quantity)\(element, \[([^\]]*)\]/g)]
        .flatMap((match) => [...match[1].matchAll(/'([A-Za-z]+)'/g)].map((k) => k[1]))
    )
    const missing = [...read].filter((key) => !RULE_INPUT_KEYS.includes(key))

    expect(missing).toEqual([])

    expect(read.size).toBeGreaterThanOrEqual(RULE_INPUT_KEYS.length)
    const catalogue = source.slice(source.indexOf('const BIM_RULES'))
    expect(catalogue).not.toMatch(
      /(?:dimensionProperty|numericProperty|property|quantity)\(element,\s*[^[\s]/
    )

    const fields = new Set(
      [...source.matchAll(/element\.([a-zA-Z]+)/g)].map((match) => match[1])
    )
    const missingFields = [...fields].filter(
      (field) => !RULE_INPUT_FIELDS.includes(field) && field !== 'ifcType'
    )

    expect(missingFields).toEqual([])
  })

  it('drops the payload the rules never read', () => {
    const [compact] = projectRuleInputs([MODEL[0]]) as unknown as Array<Record<string, unknown>>
    const properties = compact.p as Record<string, Record<string, unknown>>

    expect(Object.keys(properties)).toEqual(['Pset_WallCommon'])
    expect(Object.keys(properties.Pset_WallCommon).sort()).toEqual([
      'AcousticRating',
      'FireRating',
      'IsExternal',
      'LoadBearing',
      'ThermalTransmittance',
    ])
  })

  it('is materially smaller than the rows it replaces', () => {
    const before = JSON.stringify(MODEL).length
    const after = JSON.stringify(buildStoredRuleInputs(MODEL, false)).length

    expect(after).toBeLessThan(before / 2)
  })

  it('carries the truncation flag, so a capped run stays capped', () => {
    expect(readStoredRuleInputs(buildStoredRuleInputs(MODEL, true))?.truncated).toBe(true)
  })

  it('refuses a projection from an older schema', () => {
    const stale = { ...buildStoredRuleInputs(MODEL, false), version: 0 }

    expect(readStoredRuleInputs(stale)).toBeNull()
  })

  it('refuses anything that is not a projection', () => {
    expect(readStoredRuleInputs(null)).toBeNull()
    expect(readStoredRuleInputs('nope')).toBeNull()
    expect(readStoredRuleInputs({ version: 1 })).toBeNull()
  })
})

describe('search keys', () => {
  it('emits the bare key and the set-qualified key, both lowercased', () => {
    const keys = buildSearchKeys(
      element({ ifcType: 'IfcWall', properties: { Pset_WallCommon: { FireRating: 'REI 90' } } })
    )

    expect(keys).toEqual({
      'p:firerating': ['rei 90'],
      'p:pset_wallcommon.firerating': ['rei 90'],
    })
  })

  it('separates quantities from properties', () => {
    const keys = buildSearchKeys(
      element({
        ifcType: 'IfcDoor',
        properties: { Pset_DoorCommon: { Width: 0.9 } },
        quantities: { Qto_DoorBaseQuantities: { Width: 0.91 } },
      })
    )

    expect(Object.keys(keys).sort()).toEqual([
      'p:pset_doorcommon.width',
      'p:width',
      'q:qto_doorbasequantities.width',
      'q:width',
    ])
    expect(keys['p:width']).toEqual(['0.9'])
    expect(keys['q:width']).toEqual(['0.91'])
  })

  it('collects every value a bare key takes across sets', () => {
    const keys = buildSearchKeys(
      element({
        ifcType: 'IfcWall',
        properties: {
          Pset_WallCommon: { FireRating: 'REI 90' },
          'Revit Type Parameters': { FireRating: 'F90' },
        },
      })
    )

    expect(keys['p:firerating'].sort()).toEqual(['f90', 'rei 90'])
  })

  it('renders booleans and numbers the way the SQL does', () => {
    const keys = buildSearchKeys(
      element({
        ifcType: 'IfcWall',
        properties: { Pset_WallCommon: { IsExternal: true, ThermalTransmittance: 0.21 } },
      })
    )

    expect(keys['p:isexternal']).toEqual(['true'])
    expect(keys['p:thermaltransmittance']).toEqual(['0.21'])
  })

  it('writes numbers in plain decimal, where `String()` would use an exponent', () => {
    const keys = buildSearchKeys(
      element({
        ifcType: 'IfcWall',
        properties: {
          Pset_WallCommon: {
            Height: 1e21,
            Width: 1e-7,
            ClearWidth: 1.5e-7,
            ClearHeight: -1e-7,
          },
        },
      })
    )

    expect(keys['p:height']).toEqual(['1000000000000000000000'])
    expect(keys['p:width']).toEqual(['0.0000001'])
    expect(keys['p:clearwidth']).toEqual(['0.00000015'])
    expect(keys['p:clearheight']).toEqual(['-0.0000001'])
  })

  it('leaves values Postgres and `String()` already agree on untouched', () => {
    const keys = buildSearchKeys(
      element({
        ifcType: 'IfcWall',
        properties: {
          Pset_WallCommon: {
            Width: 0.9,
            ThermalTransmittance: 0.21,
            AcousticRating: 53,
            LoadBearing: true,
            FireRating: 'REI 90',
          },
        },
      })
    )

    expect(keys['p:width']).toEqual(['0.9'])
    expect(keys['p:thermaltransmittance']).toEqual(['0.21'])
    expect(keys['p:acousticrating']).toEqual(['53'])
    expect(keys['p:loadbearing']).toEqual(['true'])
    expect(keys['p:firerating']).toEqual(['rei 90'])
  })

  it('keeps the KEY of a null-valued property but not a value for it', () => {
    const keys = buildSearchKeys(
      element({ ifcType: 'IfcWall', properties: { Pset_WallCommon: { FireRating: null } } })
    )

    expect(keys).toEqual({ 'p:firerating': [], 'p:pset_wallcommon.firerating': [] })
  })

  it('keeps the real values when one set is null and another is not', () => {
    const keys = buildSearchKeys(
      element({
        ifcType: 'IfcWall',
        properties: {
          Pset_WallCommon: { FireRating: null },
          'Revit Type Parameters': { FireRating: 'F90' },
        },
      })
    )

    expect(keys['p:firerating']).toEqual(['f90'])
    expect(keys['p:pset_wallcommon.firerating']).toEqual([])
  })

  it('gives an element with no properties an empty map, not null', () => {
    expect(buildSearchKeys(element({ ifcType: 'IfcSite' }))).toEqual({})
  })
})
