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

describe('the compliance cache', () => {
  beforeEach(() => clearComplianceCache())

  it('returns what was stored for the same model and facts', () => {
    writeComplianceCache('m-1', 4, 'residential', 'AT', value('a'))

    expect(readComplianceCache('m-1', 4, 'residential', 'AT')?.complianceShoppingList[0].path).toBe('a')
  })

  it('misses on a different Gebäudeklasse', () => {
    // GK4 wants R 60 where GK5 wants R 90. Serving one for the other would
    // report a wall as compliant against a threshold nobody applied.
    writeComplianceCache('m-1', 4, 'residential', 'AT', value('gk4'))

    expect(readComplianceCache('m-1', 5, 'residential', 'AT')).toBeNull()
  })

  it('misses on a different Hauptnutzung', () => {
    writeComplianceCache('m-1', 4, 'residential', 'AT', value('a'))

    expect(readComplianceCache('m-1', 4, 'office', 'AT')).toBeNull()
  })

  it('misses on a different site: an OIB verdict is no verdict in Germany', () => {
    writeComplianceCache('m-1', 4, 'residential', 'AT-9>AT', value('a'))

    expect(readComplianceCache('m-1', 4, 'residential', 'DE')).toBeNull()
    expect(readComplianceCache('m-1', 4, 'residential', 'unplaced')).toBeNull()
  })

  it('misses on a different revision', () => {
    // A new revision is a new model id, which is what makes the whole thing
    // safe: an entry can never describe a model that has since changed.
    writeComplianceCache('m-1', 4, null, 'AT', value('rev3'))

    expect(readComplianceCache('m-2', 4, null, 'AT')).toBeNull()
  })

  it('distinguishes an absent fact from a set one', () => {
    writeComplianceCache('m-1', null, null, 'AT', value('none'))
    writeComplianceCache('m-1', 4, null, 'AT', value('gk4'))

    expect(readComplianceCache('m-1', null, null, 'AT')?.complianceShoppingList[0].path).toBe('none')
    expect(readComplianceCache('m-1', 4, null, 'AT')?.complianceShoppingList[0].path).toBe('gk4')
  })

  it('carries the truncation flag through, so the warning survives a hit', () => {
    // A cached run of a capped model must still say it was capped; otherwise
    // the second reader sees the same partial verdicts without the banner.
    writeComplianceCache('m-1', 4, null, 'AT', { ...value('a'), truncated: true })

    expect(readComplianceCache('m-1', 4, null, 'AT')?.truncated).toBe(true)
  })

  it('expires an entry after an hour', () => {
    const t0 = 1_000_000
    writeComplianceCache('m-1', 4, null, 'AT', value('a'), t0)

    expect(readComplianceCache('m-1', 4, null, 'AT', t0 + 59 * 60 * 1000)).not.toBeNull()
    expect(readComplianceCache('m-1', 4, null, 'AT', t0 + 61 * 60 * 1000)).toBeNull()
  })

  it('evicts the least recently READ, not the oldest written', () => {
    for (let i = 0; i < 64; i += 1) writeComplianceCache(`m-${i}`, 4, null, 'AT', value(`v${i}`))
    // Touch the oldest so it becomes the most recent.
    expect(readComplianceCache('m-0', 4, null, 'AT')).not.toBeNull()
    writeComplianceCache('m-new', 4, null, 'AT', value('new'))

    expect(readComplianceCache('m-0', 4, null, 'AT')).not.toBeNull()
    expect(readComplianceCache('m-1', 4, null, 'AT')).toBeNull()
  })

  it('never grows past its cap', () => {
    for (let i = 0; i < 200; i += 1) writeComplianceCache(`m-${i}`, 4, null, 'AT', value(`v${i}`))

    const present = Array.from({ length: 200 }, (_, i) =>
      readComplianceCache(`m-${i}`, 4, null, 'AT')
    ).filter(Boolean)
    expect(present).toHaveLength(64)
  })
})
