/**
 * @vitest-environment node
 *
 * A platform directive applies where its authority is competent (design §3.3):
 * MA 37 decides for Vienna, so its directive is excluded in Graz, by state or
 * by municipality through the territory chain.
 */
import { describe, expect, it } from 'vitest'
import { platformDirectiveApplies, territoryChain, type PlatformAuthority } from './applicability'

const MA37: PlatformAuthority = { id: 'authority:at-wien-ma37', name: 'MA 37 Baupolizei', competenceTerritoryIds: ['AT-9'] }
const AUTHORITIES = new Map([[MA37.id, MA37]])
const PARENTS = new Map<string, string[]>([
  ['AT:gkz:60101', ['AT-6']],
  ['AT:gkz:90101', ['AT-9']],
  ['AT-6', ['AT']],
  ['AT-9', ['AT']],
])
const ADDRESSEES = [{ name: 'MA 37', territoryId: 'AT-9', authorityId: MA37.id }]

describe('platformDirectiveApplies', () => {
  it('applies an MA 37 directive in Vienna and in a Viennese district (positive control)', () => {
    expect(platformDirectiveApplies(ADDRESSEES, AUTHORITIES, PARENTS, 'AT-9')).toEqual({
      verdict: 'applies',
      authority: 'MA 37 Baupolizei',
      territoryId: 'AT-9',
    })
    expect(platformDirectiveApplies(ADDRESSEES, AUTHORITIES, PARENTS, 'AT:gkz:90101').verdict).toBe('applies')
  })

  it('excludes it in Graz, by state and by municipality', () => {
    expect(platformDirectiveApplies(ADDRESSEES, AUTHORITIES, PARENTS, 'AT-6')).toEqual({ verdict: 'excluded' })
    expect(platformDirectiveApplies(ADDRESSEES, AUTHORITIES, PARENTS, 'AT:gkz:60101')).toEqual({ verdict: 'excluded' })
  })

  it('says the authority is unknown when the project’s territory is, rather than guessing', () => {
    expect(platformDirectiveApplies(ADDRESSEES, AUTHORITIES, PARENTS, null)).toEqual({ verdict: 'authority_unknown' })
  })

  it('reads an addressee that names no authority record by the territory it names', () => {
    const named = [{ name: 'MA 37', territoryId: 'AT-9' }]
    expect(platformDirectiveApplies(named, new Map(), PARENTS, 'AT-6')).toEqual({ verdict: 'excluded' })
    expect(platformDirectiveApplies(named, new Map(), PARENTS, 'AT-9').verdict).toBe('applies')
  })

  it('says the authority is unknown when its record cannot be read, rather than applying by its territory', () => {
    // Rolled back, or a country the office is not entitled to: the record is gone from the map.
    expect(platformDirectiveApplies(ADDRESSEES, new Map(), PARENTS, 'AT-9')).toEqual({ verdict: 'authority_unknown' })
    expect(platformDirectiveApplies(ADDRESSEES, new Map(), PARENTS, 'AT-6')).toEqual({ verdict: 'authority_unknown' })
  })

  it('still applies by a readable addressee when another one cannot be read', () => {
    const both = [{ name: 'gone', territoryId: 'AT-9', authorityId: 'authority:gone' }, ...ADDRESSEES]
    expect(platformDirectiveApplies(both, AUTHORITIES, PARENTS, 'AT-9').verdict).toBe('applies')
  })
})

describe('territoryChain', () => {
  it('walks the parents, then the ISO country, and stops on a cycle', () => {
    expect(territoryChain('AT:gkz:60101', PARENTS)).toEqual(['AT:gkz:60101', 'AT-6', 'AT'])
    expect(territoryChain('X', new Map([['X', ['Y']], ['Y', ['X']]]))).toEqual(['X', 'Y'])
  })
})
