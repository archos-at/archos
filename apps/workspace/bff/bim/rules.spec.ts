import { describe, expect, it } from 'vitest'
import {
  attachConfirmations,
  canonicalBimRuleId,
  LEGACY_BIM_RULE_IDS,
  outstandingRules,
  BIM_RULES,
  ifcTypeVariants,
  missingPropertyShoppingList,
  renderBimRules,
  rulesWithOpenWork,
  summarizeBimRules,
  runBimRules as runOnSite,
  type BimRuleFacts,
} from './rules'
import { runBimRules, element, ruleOf, STOREYS } from './rules.fixtures'
import { SETTLED_BASES } from './rule-basis.fixtures'
import type { BimElement } from './types'

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
