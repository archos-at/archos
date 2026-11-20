import { describe, expect, it } from 'vitest'
import { runBimRules, element, ruleOf } from './rules.fixtures'

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
