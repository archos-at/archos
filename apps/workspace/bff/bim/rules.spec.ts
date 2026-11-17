import { describe, expect, it } from 'vitest'
import {
  attachConfirmations,
  canonicalBimRuleId,
  LEGACY_BIM_RULE_IDS,
  outstandingRules,
  BIM_RULES,
  diffBimCompliance,
  ifcTypeVariants,
  renderBimComplianceDiff,
  missingPropertyShoppingList,
  renderBimRules,
  runBimRules as runOnSite,
  rulesWithOpenWork,
  type BimRuleFacts,
  summarizeBimRules,
} from './rules'
import { SETTLED_BASES } from './rule-basis.fixtures'
import type { BimElement } from './types'

const runBimRules = (elements: readonly BimElement[], facts: Partial<BimRuleFacts> = {}) =>
  runOnSite(elements, { bases: SETTLED_BASES, ...facts })

function element(overrides: Partial<BimElement> & Pick<BimElement, 'ifcType'>): BimElement {
  return {
    globalId: `g-${overrides.name ?? overrides.ifcType}`,
    expressId: 1,
    name: null,
    description: null,
    predefinedType: null,
    objectType: null,
    tag: null,
    typeName: null,
    containerKind: 'storey',
    containerGlobalId: null,
    containerName: 'Erdgeschoss',
    storeyGlobalId: 's-eg',
    storeyName: 'Erdgeschoss',
    materials: [],
    classifications: [],
    properties: {},
    quantities: {},
    ...overrides,
  }
}

const ruleOf = (results: ReturnType<typeof runBimRules>, id: string) => {
  const found = results.find((result) => result.ruleId === id)
  if (!found) throw new Error(`no such rule: ${id}`)
  return found
}

const STOREYS = [
  { name: 'Keller', elevation: -2.8 },
  { name: 'Erdgeschoss', elevation: 0 },
  { name: 'Obergeschoss', elevation: 3 },
]

describe('an unmeasured dimension is not a measurement of zero', () => {
  const door = (quantities: Record<string, number>): BimElement =>
    element({
      ifcType: 'IfcDoor',
      name: 'Tür 01',
      predefinedType: 'DOOR',
      quantities: { Qto_DoorBaseQuantities: quantities },
    })

  it('does not fail a door on a ClearWidth of zero', () => {
    const rule = ruleOf(
      runBimRules([door({ ClearWidth: 0, Width: 900 })], { lengthScale: 0.001 }),
      'oib4-door-clear-width'
    )
    expect(rule.failed).toBe(0)
    expect(rule.passed + rule.undecidable).toBe(1)
  })

  it('asks for the clear width rather than reporting 0,00 m', () => {
    const rule = ruleOf(
      runBimRules([door({ ClearWidth: 0 })], { lengthScale: 0.001 }),
      'oib4-door-clear-width'
    )
    expect(rule.failed).toBe(0)
    expect(rule.undecidable).toBe(1)
    expect(rule.unknowns[0]?.reading).not.toContain('0,00')
    expect(rule.missing.map((entry) => entry.path)).toContain(
      'Qto_DoorBaseQuantities.ClearWidth'
    )
  })

  it('does not fail a room on a FinishCeilingHeight of zero', () => {
    const room = element({
      ifcType: 'IfcSpace',
      name: 'Wohnen',
      quantities: { Qto_SpaceBaseQuantities: { FinishCeilingHeight: 0 } },
    })
    const rule = ruleOf(runBimRules([room], { lengthScale: 1 }), 'oib3-room-height')
    expect(rule.failed).toBe(0)
    expect(rule.undecidable).toBe(1)
  })
})

describe('OIB 2 Tabelle 1b, row 1 — the storey decides the duration', () => {
  const wallOn = (storeyName: string, rating: string) =>
    element({
      ifcType: 'IfcWall',
      name: `W-${storeyName}`,
      storeyName,
      properties: { Pset_WallCommon: { LoadBearing: true, FireRating: rating } },
    })
  const fire = (elements: ReturnType<typeof element>[], buildingClass: 1 | 2 | 3 | 4 | 5) =>
    runBimRules(elements, { buildingClass: buildingClass, storeys: STOREYS }).filter(
      (r) => r.ruleId === 'oib2-fire-resistance-load-bearing'
    )[0]

  it('fails a Kellergeschoß wall that would pass above ground', () => {
    const rule = fire([wallOn('Keller', 'R 60')], 3)

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('erforderlich R 90')
    expect(rule.failures[0].reading).toContain('Kellergeschoß')
  })

  it('still passes the same wall on the ground floor', () => {
    expect(fire([wallOn('Erdgeschoss', 'R 60')], 3).passed).toBe(1)
  })

  it('asks only R 60 of a Kellergeschoß wall in GK1 and GK2', () => {
    expect(fire([wallOn('Keller', 'R 60')], 2).passed).toBe(1)
    expect(fire([wallOn('Keller', 'R 30')], 2).failed).toBe(1)
  })

  it('applies the lighter top-storey row to the topmost storey', () => {
    expect(fire([wallOn('Obergeschoss', 'R 30')], 4).passed).toBe(1)
    expect(fire([wallOn('Erdgeschoss', 'R 30')], 4).failed).toBe(1)
  })

  it('asks nothing of the top storey in GK1', () => {
    expect(fire([wallOn('Obergeschoss', 'R 0')], 1).passed).toBe(1)
  })

  it('refuses to guess when the model publishes no storey elevations', () => {
    const rule = runBimRules([wallOn('Keller', 'R 60')], { buildingClass: 3 }).filter(
      (r) => r.ruleId === 'oib2-fire-resistance-load-bearing'
    )[0]

    expect(rule.undecidable).toBe(1)
    expect(rule.missing[0].path).toContain('Elevation')
  })

  it('does not judge a Decke by row 1 at all', () => {
    const rule = runBimRules(
      [
        element({
          ifcType: 'IfcSlab',
          name: 'Decke',
          storeyName: 'Erdgeschoss',
          properties: { Pset_SlabCommon: { LoadBearing: true, FireRating: 'R 30' } },
        }),
      ],
      { buildingClass: 5, storeys: STOREYS }
    ).filter((r) => r.ruleId === 'oib2-fire-resistance-load-bearing')[0]

    expect(rule.passed + rule.failed + rule.undecidable).toBe(0)
  })
})

describe('rules that never matched, and ticks that were not earned', () => {
  it('checks an IFC4 IfcDoorStandardCase like any other door', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcDoorStandardCase',
          name: 'T-14',
          quantities: { Qto_DoorBaseQuantities: { Width: 700 } },
        }),
      ],
      {}
    ).filter((r) => r.ruleId === 'oib4-door-clear-width')

    expect(rule.passed + rule.failed + rule.undecidable).toBe(1)
    expect(rule.failed).toBe(1)
  })

  it('checks an ElementedCase wall too', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcWallElementedCase',
          name: 'Aussenwand',
          properties: { Pset_WallCommon: { IsExternal: true, ThermalTransmittance: 0.5 } },
        }),
      ],
      { mainUse: 'residential' }
    ).filter((r) => r.ruleId === 'oib6-u-value-external-wall')

    expect(rule.failed).toBe(1)
  })

  it('does not count a requirement with unknowns left as erfüllt', () => {
    const summary = summarizeBimRules([
      {
        ruleId: 'r',
        richtlinie: 'OIB 3',
        clause: '2',
        titleDe: 't',
        thresholdDe: 's',
        applicable: true,
        passed: 9,
        failed: 0,
        undecidable: 2,
        failures: [],
        unknowns: [],
        truncated: false,
        missing: [],
      },
    ])

    expect(summary.rulesPassing).toBe(0)
    expect(summary.rulesUndecidable).toBe(1)
  })

  it('still counts a fully settled requirement as erfüllt', () => {
    const summary = summarizeBimRules([
      {
        ruleId: 'r',
        richtlinie: 'OIB 3',
        clause: '2',
        titleDe: 't',
        thresholdDe: 's',
        applicable: true,
        passed: 9,
        failed: 0,
        undecidable: 0,
        failures: [],
        unknowns: [],
        truncated: false,
        missing: [],
      },
    ])

    expect(summary.rulesPassing).toBe(1)
  })
})

describe('false verdicts a reviewer found by running the catalogue', () => {
  const facts = { buildingClass: 4 as const, storeys: STOREYS }

  it('asks R of a column, not REI — a linear member cannot separate', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcColumn',
          name: 'Stuetze EG',
          properties: { Pset_ColumnCommon: { LoadBearing: true, FireRating: 'R 90' } },
        }),
      ],
      facts
    ).filter((r) => r.ruleId === 'oib2-fire-resistance-load-bearing')

    expect(rule.failed).toBe(0)
    expect(rule.passed).toBe(1)
  })

  it('asks R of a load-bearing WALL too — row 1 never says REI', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcWall',
          name: 'Wand',
          properties: { Pset_WallCommon: { LoadBearing: true, FireRating: 'R 90' } },
        }),
      ],
      facts
    ).filter((r) => r.ruleId === 'oib2-fire-resistance-load-bearing')

    expect(rule.failed).toBe(0)
    expect(rule.passed).toBe(1)
  })

  it('does not let a wall vanish because nobody said whether it is load-bearing', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcWall',
          name: 'Wand ohne Angabe',
          properties: { Pset_WallCommon: { FireRating: 'REI 90' } },
        }),
      ],
      facts
    ).filter((r) => r.ruleId === 'oib2-fire-resistance-load-bearing')

    expect(rule.undecidable).toBe(1)
    expect(rule.unknowns[0].reading).toMatch(/tragend/i)
    expect(rule.missing.some((m) => m.path.includes('LoadBearing'))).toBe(true)
  })

  it('keeps a wall that says it is NOT load-bearing out of scope', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcWall',
          name: 'Trennwand',
          properties: { Pset_WallCommon: { LoadBearing: false } },
        }),
      ],
      facts
    ).filter((r) => r.ruleId === 'oib2-fire-resistance-load-bearing')

    expect(rule.passed + rule.failed + rule.undecidable).toBe(0)
  })

  it('refuses U = 0 rather than calling it the best wall ever built', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcWall',
          name: 'Aussenwand',
          properties: { Pset_WallCommon: { IsExternal: true, ThermalTransmittance: 0 } },
        }),
      ],
      { mainUse: 'residential' }
    ).filter((r) => r.ruleId === 'oib6-u-value-external-wall')

    expect(rule.passed).toBe(0)
    expect(rule.undecidable).toBe(1)
  })

  it('refuses a window U of 0 the same way', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcWindow',
          name: 'Fenster',
          properties: { Pset_WindowCommon: { ThermalTransmittance: 0 } },
        }),
      ],
      { mainUse: 'residential' }
    ).filter((r) => r.ruleId === 'oib6-u-value-window')

    expect(rule.passed).toBe(0)
    expect(rule.undecidable).toBe(1)
  })

  it('refuses a declared Schalldämm-Maß of 0', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcWall',
          name: 'Wohnungstrennwand',
          properties: { Pset_WallCommon: { IsExternal: false, AcousticRating: 0 } },
        }),
      ],
      { mainUse: 'residential' }
    ).filter((r) => r.ruleId === 'oib5-sound-insulation-declared')

    expect(rule.passed).toBe(0)
    expect(rule.undecidable).toBe(1)
  })

  it('still accepts a real Schalldämm-Maß', () => {
    const [rule] = runBimRules(
      [
        element({
          ifcType: 'IfcWall',
          name: 'Wohnungstrennwand',
          properties: { Pset_WallCommon: { IsExternal: false, AcousticRating: 55 } },
        }),
      ],
      { mainUse: 'residential' }
    ).filter((r) => r.ruleId === 'oib5-sound-insulation-declared')

    expect(rule.passed).toBe(1)
  })
})

describe('the spellings one requested IFC type can have', () => {
  it('expands a plain type to the IFC4 subtypes an exporter may have written', () => {
    expect(ifcTypeVariants('IfcWall')).toEqual([
      'ifcwall',
      'ifcwallstandardcase',
      'ifcwallelementedcase',
    ])
  })

  it('matches the plain type when the caller named a subtype', () => {
    expect(ifcTypeVariants('IfcDoorStandardCase')).toContain('ifcdoor')
  })

  it('is case-insensitive, like the column comparison it feeds', () => {
    expect(ifcTypeVariants('IFCSLAB')).toContain('ifcslab')
  })
})

describe('the catalog itself', () => {
  it('has a unique id, a Richtlinie and a visible threshold on every rule', () => {
    const ids = BIM_RULES.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of BIM_RULES) {
      expect(rule.thresholdDe.length).toBeGreaterThan(0)
      expect(rule.designation.length).toBeGreaterThan(0)
      expect(rule.edition.length).toBeGreaterThan(0)
      expect(rule.clause.length).toBeGreaterThan(0)
    }
  })

  it('reads no geometry — every rule is decidable from published values', () => {
    expect(BIM_RULES.map((rule) => rule.id).sort()).toEqual([
      'oib2-fire-resistance-load-bearing',
      'oib3-room-height',
      'oib4-door-clear-width',
      'oib4-stair-rise-run-ratio',
      'oib5-sound-insulation-declared',
      'oib6-u-value-external-wall',
      'oib6-u-value-window',
    ])
  })
})

describe('rule ids written before the English names', () => {
  it('maps every legacy id to a rule the catalog has, and leaves current and unknown ids alone', () => {
    const current = new Set(BIM_RULES.map((rule) => rule.id))
    for (const [legacy, mapped] of Object.entries(LEGACY_BIM_RULE_IDS)) {
      expect(current.has(mapped), legacy).toBe(true)
      expect(canonicalBimRuleId(legacy)).toBe(mapped)
    }
    expect(canonicalBimRuleId('oib3-room-height')).toBe('oib3-room-height')
    expect(canonicalBimRuleId('oib9-unknown')).toBe('oib9-unknown')
  })
})

describe('a missing value is never a pass', () => {
  it('reports undecidable, not pass, for every rule whose value is absent', () => {
    const bare = [
      element({ ifcType: 'IfcStairFlight', name: 'T1' }),
      element({ ifcType: 'IfcDoor', name: 'D1' }),
      element({ ifcType: 'IfcSpace', name: 'Wohnen' }),
      element({ ifcType: 'IfcWall', name: 'W1', properties: { Pset_WallCommon: { LoadBearing: true } } }),
      element({ ifcType: 'IfcWall', name: 'W2', properties: { Pset_WallCommon: { IsExternal: true } } }),
      element({ ifcType: 'IfcWindow', name: 'F1' }),
    ]
    const results = runBimRules(bare, { buildingClass: 3, mainUse: 'residential' })
    for (const result of results.filter((entry) => entry.applicable)) {
      expect(result.passed, `${result.ruleId} must not pass a bare element`).toBe(0)
    }
    expect(summarizeBimRules(results).elementsUndecidable).toBeGreaterThan(0)
  })

  it('names the exact property that would settle each undecidable verdict', () => {
    const results = runBimRules(
      [element({ ifcType: 'IfcWall', name: 'W1', properties: { Pset_WallCommon: { LoadBearing: true } } })],
      { buildingClass: 5, storeys: STOREYS }
    )
    const rule = ruleOf(results, 'oib2-fire-resistance-load-bearing')
    expect(rule.undecidable).toBe(1)
    expect(rule.missing[0].path).toContain('FireRating')
    expect(rule.unknowns[0].reading).toContain('R 90')
  })
})

describe('units', () => {
  it('reads a door width in millimetres as metres', () => {
    const results = runBimRules([
      element({ ifcType: 'IfcDoor', name: 'D1', quantities: { Qto_DoorBaseQuantities: { ClearWidth: 900 } } }),
    ])
    const rule = ruleOf(results, 'oib4-door-clear-width')
    expect(rule.passed).toBe(1)
    expect(rule.failures).toHaveLength(0)
  })

  it('reads the same width expressed in metres identically', () => {
    const results = runBimRules([
      element({ ifcType: 'IfcDoor', name: 'D1', quantities: { Qto_DoorBaseQuantities: { ClearWidth: 0.9 } } }),
    ])
    expect(ruleOf(results, 'oib4-door-clear-width').passed).toBe(1)
  })

  it('still fails a genuinely narrow door in either unit', () => {
    for (const width of [700, 0.7]) {
      const results = runBimRules([
        element({ ifcType: 'IfcDoor', name: 'D1', quantities: { Qto_DoorBaseQuantities: { Width: width } } }),
      ])
      const rule = ruleOf(results, 'oib4-door-clear-width')
      expect(rule.failed, `width ${width}`).toBe(1)
      expect(rule.failures[0].reading).toContain('0,80')
    }
  })
})

describe('oib4-stair-rise-run-ratio', () => {
  const stair = (riser: number, tread: number) =>
    element({
      ifcType: 'IfcStairFlight',
      name: 'T1',
      properties: { Pset_StairFlightCommon: { RiserHeight: riser, TreadLength: tread } },
    })

  it('accepts a comfortable stair and shows the arithmetic', () => {
    const rule = ruleOf(runBimRules([stair(0.17, 0.29)]), 'oib4-stair-rise-run-ratio')
    expect(rule.passed).toBe(1)
  })

  it('rejects a stair outside the band and names the band', () => {
    const rule = ruleOf(runBimRules([stair(0.2, 0.24)]), 'oib4-stair-rise-run-ratio')
    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('2h + b')
    expect(rule.failures[0].reading).toContain('59–65 cm')
  })

  it('rejects a stair whose ratio is in band but whose riser is too high', () => {
    const rule = ruleOf(runBimRules([stair(0.19, 0.25)]), 'oib4-stair-rise-run-ratio')
    expect(rule.failed).toBe(1)
  })
})

describe('oib2-fire-resistance-load-bearing', () => {
  const wall = (rating: string | null, loadBearing = true) =>
    element({
      ifcType: 'IfcWall',
      name: 'W1',
      properties: {
        Pset_WallCommon: {
          LoadBearing: loadBearing,
          ...(rating === null ? {} : { FireRating: rating }),
        },
      },
    })

  it('passes a wall that meets its Gebäudeklasse', () => {
    const rule = ruleOf(runBimRules([wall('REI 90')], { buildingClass: 5, storeys: STOREYS }), 'oib2-fire-resistance-load-bearing')
    expect(rule.passed).toBe(1)
  })

  it('fails a wall that is short of the minutes', () => {
    const rule = ruleOf(runBimRules([wall('REI 30')], { buildingClass: 5, storeys: STOREYS }), 'oib2-fire-resistance-load-bearing')
    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('erforderlich R 90')
  })

  it('fails a rating with enough minutes but the wrong criteria', () => {
    const rule = ruleOf(runBimRules([wall('EI 90')], { buildingClass: 5, storeys: STOREYS }), 'oib2-fire-resistance-load-bearing')
    expect(rule.failed).toBe(1)
  })

  it('ignores non-load-bearing walls entirely', () => {
    const rule = ruleOf(
      runBimRules([wall(null, false)], { buildingClass: 5, storeys: STOREYS }),
      'oib2-fire-resistance-load-bearing'
    )
    expect(rule.passed + rule.failed + rule.undecidable).toBe(0)
  })

  it('cannot decide without the Gebäudeklasse — and says that, not "nicht einschlägig"', () => {
    const rule = ruleOf(
      runBimRules([wall('R 30')], { storeys: STOREYS }),
      'oib2-fire-resistance-load-bearing'
    )
    expect(rule.applicable).toBe(true)
    expect(rule.passed).toBe(0)
    expect(rule.failed).toBe(0)
    expect(rule.undecidable).toBe(1)
    expect(rule.unknowns[0]?.reading).toContain('Gebäudeklasse unbekannt')
    expect(rule.missing.map((entry) => entry.path)).toContain('Projektangabe: Gebäudeklasse')
  })

  it('refuses to call every storey the top one when the export wrote no elevations', () => {
    const flat = [
      { name: 'Kellergeschoß', elevation: 0 },
      { name: 'Erdgeschoß', elevation: 0 },
      { name: '1.Obergeschoß', elevation: 0 },
    ]
    const walls = flat.map((storey, index) => ({
      ...wall(null),
      globalId: `w-${index}`,
      storeyName: storey.name,
    }))
    const rule = ruleOf(
      runBimRules(walls, { buildingClass: 1, storeys: flat }),
      'oib2-fire-resistance-load-bearing'
    )

    expect(rule.passed).toBe(0)
    expect(rule.undecidable).toBe(3)
    expect(rule.unknowns[0]?.reading).toContain('Geschoßlage')
  })

  it('still names the top storey when the stack has real elevations', () => {
    const stack = [
      { name: 'Erdgeschoß', elevation: 0 },
      { name: '1.Obergeschoß', elevation: 3 },
    ]
    const rule = ruleOf(
      runBimRules([{ ...wall(null), storeyName: '1.Obergeschoß' }], {
        buildingClass: 1,
        storeys: stack,
      }),
      'oib2-fire-resistance-load-bearing'
    )
    expect(rule.passed).toBe(1)
  })

  it('does not cry wolf over the older F-classification', () => {
    const rule = ruleOf(runBimRules([wall('F 90')], { buildingClass: 5, storeys: STOREYS }), 'oib2-fire-resistance-load-bearing')
    expect(rule.failed).toBe(0)
    expect(rule.undecidable).toBe(1)
    expect(rule.unknowns[0].reading).toContain('F 90')
    expect(rule.unknowns[0].reading).toContain('manuell')
  })

  it('refuses to pick a side of a combined declaration', () => {
    for (const combined of ['R 30 / EI 90', 'REI 90/EI 30', 'R 30 und EI 90']) {
      const rule = ruleOf(
        runBimRules([wall(combined)], { buildingClass: 3, storeys: STOREYS }),
        'oib2-fire-resistance-load-bearing'
      )
      expect(rule.undecidable, combined).toBe(1)
      expect(rule.failed, combined).toBe(0)
    }
  })

  it('still fails a genuine European shortfall rather than hiding behind unreadable', () => {
    expect(
      ruleOf(runBimRules([wall('REI 30')], { buildingClass: 5, storeys: STOREYS }), 'oib2-fire-resistance-load-bearing').failed
    ).toBe(1)
  })

  it('reports an unreadable rating as undecidable, not as a failure', () => {
    const rule = ruleOf(
      runBimRules([wall('feuerhemmend')], { buildingClass: 3, storeys: STOREYS }),
      'oib2-fire-resistance-load-bearing'
    )
    expect(rule.undecidable).toBe(1)
    expect(rule.failed).toBe(0)
  })
})

describe('reading a number out of a string a CAD wrote', () => {
  const wall = (uValue: string | number) =>
    element({
      ifcType: 'IfcWall',
      name: 'AW',
      properties: { Pset_WallCommon: { IsExternal: true, ThermalTransmittance: uValue } },
    })

  it('does not concatenate digits that were never part of the value', () => {
    for (const written of ['0,35 W/m2K', '0.35 W/m²K', '0,35', 0.35, '0.35 W/(m2.K)']) {
      const rule = ruleOf(runBimRules([wall(written)]), 'oib6-u-value-external-wall')
      expect(rule.passed, `written as ${JSON.stringify(written)}`).toBe(1)
    }
  })

  it('still fails a genuinely high U-value written the same way', () => {
    expect(ruleOf(runBimRules([wall('0,45 W/m2K')]), 'oib6-u-value-external-wall').failed).toBe(1)
  })

  it('refuses a string that does not start with a number', () => {
    const rule = ruleOf(runBimRules([wall('Klasse 2 gemäß ÖNORM')]), 'oib6-u-value-external-wall')
    expect(rule.undecidable).toBe(1)
    expect(rule.passed + rule.failed).toBe(0)
  })
})

describe('the declared unit beats the guess', () => {
  const door = (width: number) =>
    element({ ifcType: 'IfcDoor', name: 'D1', quantities: { Qto_DoorBaseQuantities: { ClearWidth: width } } })

  it('uses the model\u2019s declared length scale when it has one', () => {
    const guessed = ruleOf(runBimRules([door(0.9)]), 'oib4-door-clear-width')
    expect(guessed.passed).toBe(1)
    const declared = ruleOf(
      runBimRules([door(0.9)], { lengthScale: 0.001 }),
      'oib4-door-clear-width'
    )
    expect(declared.failed).toBe(1)
  })

  it('reads a metre-declared model literally', () => {
    const rule = ruleOf(runBimRules([door(900)], { lengthScale: 1 }), 'oib4-door-clear-width')
    expect(rule.passed).toBe(1)
    expect(rule.failed).toBe(0)
  })

  it('falls back to the magnitude guess when nothing is declared', () => {
    expect(ruleOf(runBimRules([door(900)]), 'oib4-door-clear-width').passed).toBe(1)
    expect(ruleOf(runBimRules([door(0.7)]), 'oib4-door-clear-width').failed).toBe(1)
  })
})

describe('oib4-door-clear-width', () => {
  const door = (quantities: Record<string, number>) =>
    element({ ifcType: 'IfcDoor', name: 'T-14', quantities: { Qto_DoorBaseQuantities: quantities } })

  it('reads the CLEAR width, not the nominal one, when both are published', () => {
    const rule = ruleOf(runBimRules([door({ Width: 0.9, ClearWidth: 0.78 })]), 'oib4-door-clear-width')

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('Lichte Durchgangsbreite')
  })

  it('will not call a door compliant on its nominal width alone', () => {
    const rule = ruleOf(runBimRules([door({ Width: 0.9 })]), 'oib4-door-clear-width')

    expect(rule.passed).toBe(0)
    expect(rule.undecidable).toBe(1)
    expect(rule.unknowns[0].reading).toContain('Nennbreite')
    expect(rule.missing[0].path).toContain('ClearWidth')
  })

  it('still settles a FAILURE from the nominal width', () => {
    const rule = ruleOf(runBimRules([door({ Width: 0.7 })]), 'oib4-door-clear-width')

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('Nennbreite')
  })

  it('says which property would settle it when nothing is published', () => {
    const rule = ruleOf(runBimRules([door({})]), 'oib4-door-clear-width')

    expect(rule.undecidable).toBe(1)
    expect(rule.missing[0].path).toBe('Qto_DoorBaseQuantities.ClearWidth')
  })
})

describe('oib3-room-height', () => {
  const space = (name: string, height: number | null) =>
    element({
      ifcType: 'IfcSpace',
      name,
      predefinedType: 'INTERNAL',
      quantities: height === null ? {} : { Qto_SpaceBaseQuantities: { FinishCeilingHeight: height } },
    })

  it('checks an Aufenthaltsraum', () => {
    const rule = ruleOf(runBimRules([space('Wohnen', 2.6)]), 'oib3-room-height')
    expect(rule.passed).toBe(1)
  })

  it('checks a room whose PredefinedType says nothing', () => {
    for (const predefinedType of ['NOTDEFINED', 'SPACE', 'USERDEFINED', null]) {
      const rule = ruleOf(
        runBimRules([{ ...space('Wohnen', 2.3), predefinedType }]),
        'oib3-room-height'
      )
      expect(rule.failed, `predefinedType ${predefinedType}`).toBe(1)
    }
  })

  it('still believes a PredefinedType that means something', () => {
    for (const predefinedType of ['PARKING', 'EXTERNAL', 'GFA']) {
      const rule = ruleOf(
        runBimRules([{ ...space('Wohnen', 2.0), predefinedType }]),
        'oib3-room-height'
      )
      expect(rule.passed + rule.failed + rule.undecidable, predefinedType).toBe(0)
    }
  })

  it('fails a low Aufenthaltsraum', () => {
    const rule = ruleOf(runBimRules([space('Wohnen', 2.3)]), 'oib3-room-height')
    expect(rule.failed).toBe(1)
  })

  it('leaves ENGLISH circulation and service rooms out of scope too', () => {
    const rule = ruleOf(
      runBimRules([
        space('Corridor', 2.2),
        space('Plant Room', 2.1),
        space('Storage 03', 2.0),
        space('Stair Core', 2.2),
      ]),
      'oib3-room-height'
    )
    expect(rule.passed + rule.failed + rule.undecidable).toBe(0)
  })

  it('still checks an English-named living space', () => {
    const rule = ruleOf(runBimRules([space('Living Room', 2.3)]), 'oib3-room-height')
    expect(rule.failed).toBe(1)
  })

  it('leaves circulation and service rooms out of scope', () => {
    const rule = ruleOf(
      runBimRules([space('Flur', 2.2), space('Technikraum', 2.1), space('WC', 2.2)]),
      'oib3-room-height'
    )
    expect(rule.passed + rule.failed + rule.undecidable).toBe(0)
  })

  it('will not pass a room on its GROSS height', () => {
    const gross = element({
      ifcType: 'IfcSpace',
      name: 'Wohnen',
      predefinedType: 'INTERNAL',
      quantities: { Qto_SpaceBaseQuantities: { Height: 2.65 } },
    })
    const rule = ruleOf(runBimRules([gross]), 'oib3-room-height')

    expect(rule.passed).toBe(0)
    expect(rule.undecidable).toBe(1)
    expect(rule.unknowns[0].reading).toContain('Brutto-Raumhöhe')
    expect(rule.missing[0].path).toContain('FinishCeilingHeight')
  })

  it('still settles a FAILURE from the gross height', () => {
    const gross = element({
      ifcType: 'IfcSpace',
      name: 'Wohnen',
      predefinedType: 'INTERNAL',
      quantities: { Qto_SpaceBaseQuantities: { Height: 2.3 } },
    })
    expect(ruleOf(runBimRules([gross]), 'oib3-room-height').failed).toBe(1)
  })

  it('prefers the clear height when the model publishes both', () => {
    const both = element({
      ifcType: 'IfcSpace',
      name: 'Wohnen',
      predefinedType: 'INTERNAL',
      quantities: { Qto_SpaceBaseQuantities: { Height: 2.9, FinishCeilingHeight: 2.4 } },
    })
    const rule = ruleOf(runBimRules([both]), 'oib3-room-height')

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('Lichte Raumhöhe')
  })
})

describe('room names are matched by word, not by substring', () => {
  const space = (name: string) =>
    element({
      ifcType: 'IfcSpace',
      name,
      predefinedType: 'INTERNAL',
      quantities: { Qto_SpaceBaseQuantities: { FinishCeilingHeight: 2.3 } },
    })

  it('checks the Aufenthaltsräume a substring match silently dropped', () => {
    const dropped = [
      'Level 2 Storey Plan Office', // 'store' ⊂ 'storey'
      'Upstairs Bedroom', // 'stair' ⊂ 'upstairs'
      'Showcase', // 'wc' ⊂ 'showcase'
      'Implantologie', // 'plant' ⊂ 'implantologie'
      'Badminton-Halle', // 'bad' ⊂ 'badminton'
      'Besprechung Bad Gastein', // meeting rooms named after spa towns
      'Büro Keller', // Keller is also a common Austrian surname
      'Store (Verkauf)', // a Verkaufsraum IS an Aufenthaltsraum
      'Gangküche',
    ]
    for (const name of dropped) {
      expect(ruleOf(runBimRules([space(name)]), 'oib3-room-height').failed, name).toBe(1)
    }
  })

  it('still excludes the rooms the markers are actually for', () => {
    const excluded = [
      'Flur',
      'Gang',
      'WC',
      'WC-Vorraum',
      'Technikraum',
      'TR 01 Stiegenhaus',
      'Treppenhaus',
      'Abstellraum',
      'Installationsschacht',
      'Tiefgarage',
      'Lagerraum',
      'Badezimmer',
      'Corridor',
      'Plant Room',
      'Storage 03',
      'Stair Core',
      'Hallway',
    ]
    for (const name of excluded) {
      const rule = ruleOf(runBimRules([space(name)]), 'oib3-room-height')
      expect(rule.passed + rule.failed + rule.undecidable, name).toBe(0)
    }
  })
})

describe('a reading never contradicts the verdict printed beside it', () => {
  const door = (clear: number) =>
    element({
      ifcType: 'IfcDoor',
      name: 'T-14',
      quantities: { Qto_DoorBaseQuantities: { ClearWidth: clear } },
    })

  it('widens a width that rounds onto the threshold it fails', () => {
    const rule = ruleOf(runBimRules([door(0.795)]), 'oib4-door-clear-width')

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('0,795')
    expect(rule.failures[0].reading).not.toContain('0,80 m — Schwellwert')
  })

  it('widens a Raumhöhe that rounds onto its threshold', () => {
    const rule = ruleOf(
      runBimRules([
        element({
          ifcType: 'IfcSpace',
          name: 'Wohnen',
          predefinedType: 'INTERNAL',
          quantities: { Qto_SpaceBaseQuantities: { FinishCeilingHeight: 2.496 } },
        }),
      ]),
      'oib3-room-height'
    )

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('2,496')
  })

  it('widens a U-value that rounds onto its threshold', () => {
    const rule = ruleOf(
      runBimRules([
        element({
          ifcType: 'IfcWall',
          name: 'AW-01',
          properties: { Pset_WallCommon: { IsExternal: true, ThermalTransmittance: 0.3549 } },
        }),
      ]),
      'oib6-u-value-external-wall'
    )

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('0,355')
  })

  it('widens a stair riser that rounds onto its threshold', () => {
    const rule = ruleOf(
      runBimRules([
        element({
          ifcType: 'IfcStairFlight',
          name: 'ST-1',
          properties: { Pset_StairFlightCommon: { RiserHeight: 0.1804, TreadLength: 0.28 } },
        }),
      ]),
      'oib4-stair-rise-run-ratio'
    )

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('h = 18,04')
  })

  it('does not widen an ordinary reading, and never mixes decimal separators', () => {
    const rule = ruleOf(runBimRules([door(0.7)]), 'oib4-door-clear-width')

    expect(rule.failed).toBe(1)
    expect(rule.failures[0].reading).toContain('0,70 m')
    expect(rule.failures[0].reading).not.toMatch(/\d\.\d/)
  })
})

describe('applicability', () => {
  it('drops OIB 6 for an unconditioned storage building, with the reason', () => {
    const rule = ruleOf(
      runBimRules([element({ ifcType: 'IfcWindow', name: 'F1' })], { mainUse: 'storage' }),
      'oib6-u-value-window'
    )
    expect(rule.applicable).toBe(false)
    expect(rule.notApplicableReason).toContain('OIB 6')
  })

  it('keeps a rule with no in-scope elements rather than hiding it', () => {
    const results = runBimRules([], { buildingClass: 3, mainUse: 'residential' })
    expect(results).toHaveLength(BIM_RULES.length)
    expect(summarizeBimRules(results).rulesEmpty).toBeGreaterThan(0)
  })
})

describe('oib5-sound-insulation-declared', () => {
  it('treats an undeclared value as undecidable, never as a breach', () => {
    const rule = ruleOf(
      runBimRules(
        [element({ ifcType: 'IfcWall', name: 'IW1', properties: { Pset_WallCommon: { IsExternal: false } } })],
        { mainUse: 'residential' }
      ),
      'oib5-sound-insulation-declared'
    )
    expect(rule.undecidable).toBe(1)
    expect(rule.failed).toBe(0)
  })

  const wall = (rating: string | number) =>
    element({
      ifcType: 'IfcWall',
      name: 'IW1',
      properties: { Pset_WallCommon: { IsExternal: false, AcousticRating: rating } },
    })
  const verdict = (rating: string | number) =>
    ruleOf(runBimRules([wall(rating)], { mainUse: 'residential' }), 'oib5-sound-insulation-declared')

  it('refuses prose as a declaration', () => {
    for (const prose of ['siehe Beilage', 'keine Anforderung', 'tbd', 'n/a', 'gemäß ÖNORM']) {
      const rule = verdict(prose)
      expect(rule.passed, prose).toBe(0)
      expect(rule.undecidable, prose).toBe(1)
    }
  })

  it('refuses prose that merely CONTAINS a number', () => {
    for (const prose of [
      'siehe OIB 5',
      'ÖNORM B 8115-2',
      'gemäß ÖNORM B 8115-2',
      'siehe Beiblatt 3',
      'Anforderung laut Bauteilkatalog 2019',
    ]) {
      const rule = verdict(prose)
      expect(rule.passed, prose).toBe(0)
      expect(rule.undecidable, prose).toBe(1)
    }
  })

  it('reads the rating, not the standard number standing in front of it', () => {
    expect(verdict('gemäß ÖNORM B 8115-2, Rw 55 dB').passed).toBe(1)
    expect(verdict('ÖNORM B 8115-2 / 55 dB').passed).toBe(1)
  })

  it('accepts a rated value however the exporter labelled it', () => {
    for (const rating of ['Rw 53 dB', "R'w = 55 dB", 'DnT,w 52', '52 dB', 52]) {
      const rule = verdict(rating)
      expect(rule.passed, String(rating)).toBe(1)
    }
  })

  it('quotes the string it refused, so the author can find it in the exporter', () => {
    const rule = verdict('siehe Beilage')
    expect(rule.unknowns[0]?.reading).toContain('siehe Beilage')
    expect(rule.missing.map((entry) => entry.path)).toEqual([
      'Pset_WallCommon.AcousticRating (bewertetes Maß in dB, z. B. „Rw 53 dB“)',
    ])
  })

  it('still refuses the zero an exporter writes for "nothing declared"', () => {
    for (const zero of ['0', 0, '0 dB']) {
      const rule = verdict(zero)
      expect(rule.undecidable, String(zero)).toBe(1)
      expect(rule.unknowns[0]?.reading, String(zero)).toContain('vermutlich nicht gesetzt')
    }
  })
})

describe('the IsExternal flag', () => {
  const U_VALUE_RULE = 'oib6-u-value-external-wall'
  const SOUND_RULE = 'oib5-sound-insulation-declared'
  const wall = (flag?: string | boolean) =>
    element({
      ifcType: 'IfcWall',
      name: 'W1',
      properties: {
        Pset_WallCommon: {
          ThermalTransmittance: 0.5,
          AcousticRating: 'Rw 55 dB',
          ...(flag === undefined ? {} : { IsExternal: flag }),
        },
      },
    })
  const verdicts = (flag?: string | boolean) => {
    const results = runBimRules([wall(flag)], { mainUse: 'residential' })
    return { envelope: ruleOf(results, U_VALUE_RULE), separating: ruleOf(results, SOUND_RULE) }
  }

  it('leaves a wall without the flag undecidable in both rules, whatever else it publishes', () => {
    const { envelope, separating } = verdicts()

    expect([envelope.failed, envelope.undecidable]).toEqual([0, 1])
    expect([separating.passed, separating.undecidable]).toEqual([0, 1])
    expect(envelope.unknowns[0]?.reading).toContain('außen liegt')
    expect(envelope.missing.map((entry) => entry.path)).toEqual(['Pset_WallCommon.IsExternal'])
    expect(separating.missing.map((entry) => entry.path)).toEqual([
      'Pset_WallCommon.IsExternal (bzw. Pset_SlabCommon.IsExternal)',
    ])
  })

  it.each([true, 'TRUE'])('reads %s as an external wall: judged on U, out of the sound rule', (flag) => {
    const { envelope, separating } = verdicts(flag)

    expect(envelope.failed).toBe(1)
    expect(separating.passed + separating.failed + separating.undecidable).toBe(0)
  })

  it.each([false, 'FALSE'])('reads %s as an internal wall: out of the U rule, judged on sound', (flag) => {
    const { envelope, separating } = verdicts(flag)

    expect(envelope.passed + envelope.failed + envelope.undecidable).toBe(0)
    expect(separating.passed).toBe(1)
  })

  it('does not guess at a flag it cannot read', () => {
    const { envelope, separating } = verdicts('Wahr')

    expect(envelope.undecidable).toBe(1)
    expect(separating.undecidable).toBe(1)
  })

  it('keeps one shopping row per rule, so a wall in both is not added up across them', () => {
    const results = runBimRules(
      [wall(), element({ ifcType: 'IfcSlab', name: 'D1' })],
      { mainUse: 'residential' }
    )

    expect(
      missingPropertyShoppingList(results).filter((row) => row.path.includes('IsExternal'))
    ).toEqual([
      {
        path: 'Pset_WallCommon.IsExternal (bzw. Pset_SlabCommon.IsExternal)',
        elements: 2,
        rules: [SOUND_RULE],
      },
      { path: 'Pset_WallCommon.IsExternal', elements: 1, rules: [U_VALUE_RULE] },
    ])
  })
})

describe('missingPropertyShoppingList', () => {
  it('is the to-do list: one property, how many elements, which rules it unblocks', () => {
    const elements = [
      element({ ifcType: 'IfcWall', name: 'W1', properties: { Pset_WallCommon: { LoadBearing: true } } }),
      element({ ifcType: 'IfcWall', name: 'W2', properties: { Pset_WallCommon: { LoadBearing: true } } }),
      element({ ifcType: 'IfcDoor', name: 'D1' }),
    ]
    const list = missingPropertyShoppingList(
      runBimRules(elements, { buildingClass: 4, mainUse: 'residential', storeys: STOREYS })
    )
    const fireRating = list.find((entry) => entry.path.includes('FireRating'))
    expect(fireRating?.elements).toBe(2)
    expect(fireRating?.rules).toContain('oib2-fire-resistance-load-bearing')
    const counts = list.map((entry) => entry.elements)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })
})

describe('renderBimRules', () => {
  it('always carries the orientation caveat', () => {
    const rendered = renderBimRules(runBimRules([], { buildingClass: 2, storeys: STOREYS }))
    expect(rendered).toContain('keine Rechtsauskunft')
    expect(rendered).toContain('Nicht entscheidbar')
  })

  it('states the threshold beside the counts', () => {
    const rendered = renderBimRules(
      runBimRules(
        [element({ ifcType: 'IfcDoor', name: 'D1', quantities: { Qto_DoorBaseQuantities: { Width: 700 } } })],
        {}
      )
    )
    expect(rendered).toContain('1 nicht erfüllt')
    expect(rendered).toContain('≥ 0,80 m')
  })
})

describe('summarizeBimRules', () => {
  it('separates "all passed" from "nothing was decidable" from "nothing to check"', () => {
    const summary = summarizeBimRules(
      runBimRules(
        [
          element({ ifcType: 'IfcDoor', name: 'ok', quantities: { Qto_DoorBaseQuantities: { ClearWidth: 900 } } }),
          element({ ifcType: 'IfcWindow', name: 'unknown' }),
        ],
        { mainUse: 'residential' }
      )
    )
    expect(summary.rulesPassing).toBe(1)
    expect(summary.rulesUndecidable).toBe(1)
    expect(summary.rulesEmpty).toBeGreaterThan(0)
    expect(summary.elementsUndecidable).toBe(1)
  })
})


describe('diffBimCompliance', () => {
  const wall = (rating: string | null) =>
    element({
      ifcType: 'IfcWall',
      name: 'W1',
      properties: {
        Pset_WallCommon: { LoadBearing: true, ...(rating === null ? {} : { FireRating: rating }) },
      },
    })
  const facts = { buildingClass: 5 as const, storeys: STOREYS }
  const runOn = (rating: string | null) => runBimRules([wall(rating)], facts)

  it('names what a revision BROKE, first', () => {
    const changes = diffBimCompliance(runOn('REI 90'), runOn('REI 30'))
    const fire = changes.find((change) => change.ruleId === 'oib2-fire-resistance-load-bearing')
    expect(fire?.trend).toBe('broken')
    expect(changes[0].trend).toBe('broken')
  })

  it('reports a property the revision LOST as no longer decidable', () => {
    const changes = diffBimCompliance(runOn('REI 90'), runOn(null))
    expect(changes.find((change) => change.ruleId === 'oib2-fire-resistance-load-bearing')?.trend).toBe(
      'undecidable'
    )
  })

  it('reports a requirement that became decidable and passes', () => {
    const changes = diffBimCompliance(runOn(null), runOn('REI 90'))
    expect(changes.find((change) => change.ruleId === 'oib2-fire-resistance-load-bearing')?.trend).toBe(
      'decidable'
    )
  })

  it('reports a PARTIAL loss of a property, not just a total one', () => {
    const second = (rating: string | null) =>
      element({
        ifcType: 'IfcWall',
        name: 'W2',
        properties: {
          Pset_WallCommon: { LoadBearing: true, ...(rating === null ? {} : { FireRating: rating }) },
        },
      })
    const before = runBimRules([wall('REI 90'), second('REI 90')], facts)
    const after = runBimRules([wall('REI 90'), second(null)], facts)

    expect(
      diffBimCompliance(before, after).find(
        (change) => change.ruleId === 'oib2-fire-resistance-load-bearing'
      )?.trend
    ).toBe('undecidable')
  })

  it('says nothing about the rules that did not move', () => {
    expect(diffBimCompliance(runOn('REI 90'), runOn('REI 90'))).toEqual([])
  })

  it('surfaces a change of scale within the same verdict', () => {
    const before = runBimRules(
      [wall('REI 30'), element({ ifcType: 'IfcWall', name: 'W2', properties: { Pset_WallCommon: { LoadBearing: true, FireRating: 'REI 90' } } })],
      facts
    )
    const after = runBimRules(
      [wall('REI 30'), element({ ifcType: 'IfcWall', name: 'W2', properties: { Pset_WallCommon: { LoadBearing: true, FireRating: 'REI 30' } } })],
      facts
    )
    const fire = diffBimCompliance(before, after).find(
      (change) => change.ruleId === 'oib2-fire-resistance-load-bearing'
    )
    expect(fire?.trend).toBe('moved')
    expect(fire?.before.failed).toBe(1)
    expect(fire?.after.failed).toBe(2)
  })

  it('renders an empty diff as a sentence, not as nothing', () => {
    expect(renderBimComplianceDiff([])).toContain('Keine Anforderung')
  })

  it('renders the counts beside the trend', () => {
    const rendered = renderBimComplianceDiff(diffBimCompliance(runOn('REI 90'), runOn('REI 30')))
    expect(rendered).toContain('neu nicht erfüllt')
    expect(rendered).toContain('erfüllt/nicht erfüllt/nicht entscheidbar')
  })
})


describe('human confirmations', () => {
  const failing = runBimRules(
    [
      element({
        ifcType: 'IfcDoor',
        name: 'T-14',
        quantities: { Qto_DoorBaseQuantities: { Width: 0.7 } },
      }),
    ],
    {}
  )
  const confirmation = {
    ruleId: 'oib4-door-clear-width',
    modelId: 'rev-3',
    confirmedBy: 'a.muster',
    note: 'Nebenraum, keine Aufenthaltsnutzung — mit der MA 37 abgeklärt.',
    confirmedAt: '2026-03-02T09:00:00.000Z',
  }

  it('sits beside the machine verdict rather than overwriting it', () => {
    const [rule] = attachConfirmations(failing, [confirmation], 'rev-3').filter(
      (entry) => entry.ruleId === 'oib4-door-clear-width'
    )
    expect(rule.failed).toBe(1)
    expect(rule.confirmation?.confirmedBy).toBe('a.muster')
    expect(rule.confirmationStale).toBe(false)
  })

  it('shows no confirmation on a rule that now only gives a hint, and keeps it for when it judges again', () => {
    const hinted = failing.map((entry) => (entry.ruleId === 'oib4-door-clear-width' ? { ...entry, hint: 'Hinweis: Grundlage am Standort nicht bestimmt' } : entry))
    const [hint] = attachConfirmations(hinted, [confirmation], 'rev-3').filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(hint.confirmation).toBeNull()
    expect(hint.confirmationStale).toBe(false)
    const [judged] = attachConfirmations(failing, [confirmation], 'rev-3').filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(judged.confirmation?.confirmedBy).toBe('a.muster')
  })

  it('marks a confirmation made against another revision as stale', () => {
    const [rule] = attachConfirmations(failing, [confirmation], 'rev-4', ['rev-3', 'rev-4']).filter(
      (entry) => entry.ruleId === 'oib4-door-clear-width'
    )
    expect(rule.confirmation).not.toBeNull()
    expect(rule.confirmationStale).toBe(true)
  })

  it('does not show one building’s confirmation on another building’s Prüfbuch', () => {
    const [rule] = attachConfirmations(failing, [confirmation], 'nebengebaeude-1', [
      'nebengebaeude-1',
    ]).filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(rule.confirmation).toBeNull()
    expect(rule.confirmationStale).toBe(false)
  })

  it('prefers the current revision’s confirmation over an older one', () => {
    const older = { ...confirmation, modelId: 'rev-3', confirmedBy: 'a.muster' }
    const current = { ...confirmation, modelId: 'rev-4', confirmedBy: 'b.beispiel' }
    const [rule] = attachConfirmations(failing, [older, current], 'rev-4', [
      'rev-3',
      'rev-4',
    ]).filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(rule.confirmation?.confirmedBy).toBe('b.beispiel')
    expect(rule.confirmationStale).toBe(false)
  })

  it('shows the most recent older confirmation when the current revision has none', () => {
    const first = { ...confirmation, modelId: 'rev-2', confirmedAt: '2026-01-01T00:00:00.000Z' }
    const second = { ...confirmation, modelId: 'rev-3', confirmedAt: '2026-03-02T09:00:00.000Z' }
    const [rule] = attachConfirmations(failing, [first, second], 'rev-4', [
      'rev-2',
      'rev-3',
      'rev-4',
    ]).filter((entry) => entry.ruleId === 'oib4-door-clear-width')
    expect(rule.confirmation?.modelId).toBe('rev-3')
    expect(rule.confirmationStale).toBe(true)
  })

  it('leaves a rule with no confirmation alone', () => {
    const rules = attachConfirmations(failing, [], 'rev-3')
    expect(rules.every((rule) => rule.confirmation === null)).toBe(true)
    expect(rules.every((rule) => rule.confirmationStale === false)).toBe(true)
  })
})

describe('outstandingRules', () => {
  const run = runBimRules(
    [
      element({ ifcType: 'IfcDoor', name: 'narrow', quantities: { Qto_DoorBaseQuantities: { Width: 0.7 } } }),
      element({ ifcType: 'IfcWall', name: 'W1', properties: { Pset_WallCommon: { LoadBearing: true } } }),
    ],
    { buildingClass: 3, storeys: STOREYS }
  )
  const cover = (ruleId: string, modelId: string) => ({
    ruleId,
    modelId,
    confirmedBy: 'a.muster',
    note: null,
    confirmedAt: '2026-03-02T09:00:00.000Z',
  })

  it('lists what still needs a human', () => {
    const outstanding = outstandingRules(attachConfirmations(run, [], 'rev-3'))
    const ids = outstanding.map((rule) => rule.ruleId)
    expect(ids).toContain('oib4-door-clear-width')
    expect(ids).toContain('oib2-fire-resistance-load-bearing')
  })

  it('drops a rule a current confirmation covers', () => {
    const outstanding = outstandingRules(
      attachConfirmations(run, [cover('oib4-door-clear-width', 'rev-3')], 'rev-3')
    )
    expect(outstanding.map((rule) => rule.ruleId)).not.toContain('oib4-door-clear-width')
  })

  it('does NOT let a stale confirmation close a rule', () => {
    const outstanding = outstandingRules(
      attachConfirmations(run, [cover('oib4-door-clear-width', 'rev-2')], 'rev-3')
    )
    expect(outstanding.map((rule) => rule.ruleId)).toContain('oib4-door-clear-width')
  })

  it('never lists a rule that passed or stood down', () => {
    const outstanding = outstandingRules(attachConfirmations(run, [], 'rev-3'))
    expect(outstanding.length).toBeGreaterThan(0)
    for (const rule of outstanding) {
      expect(rule.applicable).toBe(true)
      expect(rule.failed + rule.undecidable).toBeGreaterThan(0)
    }
  })
})

describe('a rule judges only on its basis at the site', () => {
  const FIRE = 'oib2-fire-resistance-load-bearing'
  const wall = (fireRating: string): BimElement =>
    ({
      globalId: 'W1',
      name: 'W1',
      ifcType: 'IfcWall',
      storeyName: 'Erdgeschoss',
      properties: { Pset_WallCommon: { LoadBearing: true, FireRating: fireRating } },
    }) as unknown as BimElement
  const on = (basis: BimRuleFacts['bases'][string], fireRating = 'REI 30') =>
    runOnSite([wall(fireRating)], { bases: { ...SETTLED_BASES, [FIRE]: basis }, buildingClass: 5, storeys: STOREYS })
  const fire = (results: ReturnType<typeof on>) => results.find((rule) => rule.ruleId === FIRE)

  it('gives a verdict where its edition binds, the positive control', () => {
    expect(fire(on({ kind: 'verdict' }))).toMatchObject({ applicable: true, failed: 1 })
    expect(fire(on({ kind: 'verdict' }))?.richtlinie).toBe('OIB-Richtlinie 2, Ausgabe Mai 2023')
  })

  it('reads every element as a hint: no pass, no fail, no to-do, the reason on the reading and the line', () => {
    const reason = 'Hinweis: Schwellwerte aus Ausgabe Mai 2023; am Standort gilt Ausgabe April 2019 über StBTV'
    for (const rating of ['REI 30', 'REI 90', '']) {
      const results = on({ kind: 'hint', reason }, rating)
      const result = fire(results)
      expect(result).toMatchObject({ applicable: true, passed: 0, failed: 0, undecidable: 1, missing: [], hint: reason })
      expect(result?.unknowns[0]?.reading).toContain(reason)
      expect(rulesWithOpenWork(results).map((rule) => rule.ruleId)).not.toContain(FIRE)
      expect(outstandingRules(attachConfirmations(results, [], 'rev-3')).map((rule) => rule.ruleId)).not.toContain(FIRE)
      expect(renderBimRules(results)).toContain(`OIB-Richtlinie 2, Ausgabe Mai 2023 3 — Tragende Bauteile — Feuerwiderstand: ${reason}`)
    }
  })

  it('treats a rule with no basis as a hint, never a verdict', () => {
    expect(fire(runOnSite([wall('REI 90')], { bases: {}, buildingClass: 4 }))).toMatchObject({ passed: 0, failed: 0, undecidable: 1 })
  })
})
