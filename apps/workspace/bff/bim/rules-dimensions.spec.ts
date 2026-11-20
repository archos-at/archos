import { describe, expect, it } from 'vitest'
import { runBimRules, element, ruleOf } from './rules.fixtures'

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
