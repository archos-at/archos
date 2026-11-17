import { describe, expect, it } from 'vitest'
import { diffBimCompliance, renderBimComplianceDiff } from './compliance-diff'
import { runBimRules, element, STOREYS } from './rules.fixtures'

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
