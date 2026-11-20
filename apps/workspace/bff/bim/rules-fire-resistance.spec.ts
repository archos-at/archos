import { describe, expect, it } from 'vitest'
import { runBimRules, element, ruleOf, STOREYS } from './rules.fixtures'

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
