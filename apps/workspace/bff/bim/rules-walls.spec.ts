import { describe, expect, it } from 'vitest'
import { missingPropertyShoppingList } from './rules'
import { runBimRules, element, ruleOf } from './rules.fixtures'

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
