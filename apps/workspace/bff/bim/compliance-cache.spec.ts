/**
 * @vitest-environment node
 */
/**
 * The compliance memo.
 *
 * The dangerous direction is not a miss — a miss just costs the 1.5 s the
 * cache exists to save. It is a HIT that returns verdicts computed for
 * different inputs: the same revision judged at Gebäudeklasse 4 and at 5 has
 * different fire-resistance thresholds, and serving one for the other is a
 * silent wrong answer of exactly the kind this subsystem is built to prevent.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearComplianceCache,
  readComplianceCache,
  writeComplianceCache,
  type CachedCompliance,
} from './compliance-cache'
import { basisKey, ruleBases } from './rule-basis'
import { contextAt, contextUse } from './rule-basis.fixtures'
import { BIM_RULES } from './rules'

const value = (label: string): CachedCompliance => ({
  compliance: [],
  complianceSummary: {
    rulesApplicable: 1,
    rulesNotApplicable: 0,
    rulesFailing: 0,
    rulesUndecidable: 0,
    rulesPassing: 1,
    rulesEmpty: 0,
    elementsFailed: 0,
    elementsUndecidable: 0,
  },
  complianceShoppingList: [{ path: label, elements: 1, rules: ['r'] }],
  truncated: false,
})

const model = (id: string, updatedAt = '2026-11-06T10:00:00.000Z') => ({
  id,
  updatedAt: new Date(updatedAt),
})

describe('the compliance cache', () => {
  beforeEach(() => clearComplianceCache())

  it('returns what was stored for the same model and facts', () => {
    writeComplianceCache(model('m-1'), 4, 'residential', 'AT', value('a'))

    expect(readComplianceCache(model('m-1'), 4, 'residential', 'AT')?.complianceShoppingList[0].path).toBe('a')
  })

  it('misses on a different Gebäudeklasse', () => {
    // GK4 wants R 60 where GK5 wants R 90. Serving one for the other would
    // report a wall as compliant against a threshold nobody applied.
    writeComplianceCache(model('m-1'), 4, 'residential', 'AT', value('gk4'))

    expect(readComplianceCache(model('m-1'), 5, 'residential', 'AT')).toBeNull()
  })

  it('misses on a different Hauptnutzung', () => {
    writeComplianceCache(model('m-1'), 4, 'residential', 'AT', value('a'))

    expect(readComplianceCache(model('m-1'), 4, 'office', 'AT')).toBeNull()
  })

  it('misses on a changed basis: a verdict where one edition binds is a hint where another does', () => {
    const at = (territoryId: string, label: string) =>
      basisKey(ruleBases(BIM_RULES, contextAt(territoryId, 'core', [contextUse('OIB-Richtlinie 2', label)])))
    writeComplianceCache(model('m-1'), 4, 'residential', at('AT-9', 'Ausgabe Mai 2023'), value('a'))

    expect(readComplianceCache(model('m-1'), 4, 'residential', at('AT-9', 'Ausgabe Mai 2023'))).not.toBeNull()
    expect(readComplianceCache(model('m-1'), 4, 'residential', at('AT-6', 'Ausgabe April 2019'))).toBeNull()
    expect(readComplianceCache(model('m-1'), 4, 'residential', basisKey(ruleBases(BIM_RULES, null)))).toBeNull()
  })

  it('misses on a different model', () => {
    writeComplianceCache(model('m-1'), 4, null, 'AT', value('rev3'))

    expect(readComplianceCache(model('m-2'), 4, null, 'AT')).toBeNull()
  })

  it('misses once the same model has been extracted again', () => {
    // A same-name re-upload keeps the model id. `updatedAt` is what tells the
    // corrected file from the one it replaced.
    writeComplianceCache(model('m-1', '2026-11-06T10:00:00.000Z'), 4, null, 'AT', value('old'))

    expect(readComplianceCache(model('m-1', '2026-11-06T10:05:00.000Z'), 4, null, 'AT')).toBeNull()
  })

  it('distinguishes an absent fact from a set one', () => {
    writeComplianceCache(model('m-1'), null, null, 'AT', value('none'))
    writeComplianceCache(model('m-1'), 4, null, 'AT', value('gk4'))

    expect(readComplianceCache(model('m-1'), null, null, 'AT')?.complianceShoppingList[0].path).toBe('none')
    expect(readComplianceCache(model('m-1'), 4, null, 'AT')?.complianceShoppingList[0].path).toBe('gk4')
  })

  it('carries the truncation flag through, so the warning survives a hit', () => {
    // A cached run of a capped model must still say it was capped; otherwise
    // the second reader sees the same partial verdicts without the banner.
    writeComplianceCache(model('m-1'), 4, null, 'AT', { ...value('a'), truncated: true })

    expect(readComplianceCache(model('m-1'), 4, null, 'AT')?.truncated).toBe(true)
  })

  it('expires an entry after an hour', () => {
    const t0 = 1_000_000
    writeComplianceCache(model('m-1'), 4, null, 'AT', value('a'), t0)

    expect(readComplianceCache(model('m-1'), 4, null, 'AT', t0 + 59 * 60 * 1000)).not.toBeNull()
    expect(readComplianceCache(model('m-1'), 4, null, 'AT', t0 + 61 * 60 * 1000)).toBeNull()
  })

  it('evicts the least recently READ, not the oldest written', () => {
    for (let i = 0; i < 64; i += 1) writeComplianceCache(model(`m-${i}`), 4, null, 'AT', value(`v${i}`))
    // Touch the oldest so it becomes the most recent.
    expect(readComplianceCache(model('m-0'), 4, null, 'AT')).not.toBeNull()
    writeComplianceCache(model('m-new'), 4, null, 'AT', value('new'))

    expect(readComplianceCache(model('m-0'), 4, null, 'AT')).not.toBeNull()
    expect(readComplianceCache(model('m-1'), 4, null, 'AT')).toBeNull()
  })

  it('never grows past its cap', () => {
    for (let i = 0; i < 200; i += 1) writeComplianceCache(model(`m-${i}`), 4, null, 'AT', value(`v${i}`))

    const present = Array.from({ length: 200 }, (_, i) =>
      readComplianceCache(model(`m-${i}`), 4, null, 'AT')
    ).filter(Boolean)
    expect(present).toHaveLength(64)
  })
})
