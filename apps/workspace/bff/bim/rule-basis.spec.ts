/**
 * A rule's basis at the site: a verdict only where its edition binds on a
 * settled gate and its scope waits on nothing; a hint with its reason
 * elsewhere; outside, naming no country, where the work has no use at all.
 */

import { describe, expect, it } from 'vitest'
import { ruleBasis } from './rule-basis'
import { contextAt, contextUse } from './rule-basis.fixtures'

const DOOR = { designation: 'OIB-Richtlinie 4', edition: 'Ausgabe Mai 2023' }
const route = (designation: string) => ({ workId: `work:${designation}`, designation, editionLabel: null, provision: null })

describe('ruleBasis', () => {
  it('gives a verdict in Wien, where the 2023 edition binds on a core gate', () => {
    expect(ruleBasis(DOOR, contextAt('AT-9', 'core', [contextUse('OIB-Richtlinie 4', 'Ausgabe Mai 2023', { route: route('WBTV') })]))).toEqual({
      kind: 'verdict',
    })
  })

  it('is a hint in Styria, where 2019 binds, and says which edition and by what', () => {
    const styria = contextAt('AT-6', 'core', [
      contextUse('OIB-Richtlinie 4', 'Ausgabe April 2019', { route: route('StBTV') }),
      contextUse('OIB-Richtlinie 4', 'Ausgabe Mai 2023', { role: 'guidance' }),
    ])
    expect(ruleBasis(DOOR, styria)).toEqual({
      kind: 'hint',
      reason: 'Hinweis: Schwellwerte aus Ausgabe Mai 2023; am Standort gilt Ausgabe April 2019 über StBTV',
    })
  })

  it('is a hint on a gate that is not settled, even where the edition binds', () => {
    for (const gate of ['none', 'open', 'not_entitled', 'knowledge_unavailable', 'organization_unplaced'] as const) {
      const basis = ruleBasis(DOOR, contextAt('AT-9', gate, [contextUse('OIB-Richtlinie 4', 'Ausgabe Mai 2023')]))
      expect(basis.kind).toBe('hint')
      expect('reason' in basis && basis.reason).toMatch(/^Hinweis: .*OIB-Richtlinie 4, Ausgabe Mai 2023/)
    }
  })

  it("is a hint where the edition's scope waits on a fact", () => {
    const check = { verdict: 'check' as const, basis: [], open: ['use'], provision: null }
    expect(ruleBasis(DOOR, contextAt('AT-9', 'full', [contextUse('OIB-Richtlinie 4', 'Ausgabe Mai 2023', { applicability: check })]))).toEqual({
      kind: 'hint',
      reason: 'Hinweis: ob OIB-Richtlinie 4, Ausgabe Mai 2023 für die Gebäude des Projekts gilt, ist offen',
    })
  })

  it('is a hint where nobody placed the project', () => {
    expect(ruleBasis(DOOR, null).kind).toBe('hint')
    expect(ruleBasis(DOOR, contextAt('AT-9', 'site_unknown')).kind).toBe('hint')
  })

  it('does not apply at a settled site in another country with no such work, and names no country', () => {
    const basis = ruleBasis(DOOR, contextAt('DE-NW', 'core', [contextUse('BauO NRW', '2018')]))
    expect(basis).toEqual({ kind: 'outside', reason: 'OIB-Richtlinie 4 gilt am Standort des Projekts nicht' })
  })

  it('is a hint, not outside, where the work is known but no edition binds, or an edition is undetermined', () => {
    expect(ruleBasis(DOOR, contextAt('AT', 'core', [contextUse('OIB-Richtlinie 4', 'Ausgabe Mai 2023', { role: 'guidance' })])).kind).toBe('hint')
    const undetermined = { ...contextAt('AT-9', 'core'), undetermined: [{ workId: 'w', reason: 'ambiguous_editions' as const }] }
    expect(ruleBasis(DOOR, undetermined).kind).toBe('hint')
  })
})
