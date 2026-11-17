/**
 * @vitest-environment node
 *
 * A platform directive applies where the competence rulesets of the site name
 * its authority (ADR-0175, design §3.3): MA 37 decides in Vienna, so its
 * directive is excluded in Graz; where the rulesets decide nothing, the answer
 * says the authority is unknown rather than reading the authority record's own
 * territory list, the guess the rulesets replaced.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { SiteAuthority } from '@/lib/site-resolution/wire'
import { directiveVerdict } from './platform'
import { chainAt } from './chain/territory-chain'

const MA37 = 'authority:at-wien-ma37'
const ADDRESSEES = [{ name: 'MA 37', territoryId: 'AT-9', authorityId: MA37 }]
const decided = (authorityId: string, name: string | null): SiteAuthority => ({
  status: 'decided',
  bodies: [{ authorityId, role: 'decides', name }],
  rulesetId: 'ruleset:competence',
  territoryId: 'AT-9',
  citation: null,
})

describe('directiveVerdict', () => {
  it('applies an MA 37 directive where the rulesets name MA 37 (positive control)', () => {
    expect(directiveVerdict(ADDRESSEES, decided(MA37, 'MA 37 Baupolizei'), 'AT:gkz:90101')).toEqual({
      verdict: 'applies',
      authority: 'MA 37 Baupolizei',
      territoryId: 'AT:gkz:90101',
    })
  })

  it('excludes it where the rulesets name another authority (Graz)', () => {
    expect(directiveVerdict(ADDRESSEES, decided('authority:graz-bba', 'Bau- und Anlagenbehörde Graz'), 'AT:gkz:60101')).toEqual({
      verdict: 'excluded',
    })
  })

  it('says the authority is unknown when the rulesets decide nothing, never applying by the record’s territory', () => {
    for (const reason of ['no_rule', 'rules_unreadable', 'no_territory'] as const) {
      expect(directiveVerdict(ADDRESSEES, { status: 'undetermined', reason }, 'AT-9')).toEqual({ verdict: 'authority_unknown' })
    }
  })

  it('says the authority is unknown for an unknown site, and for addressees that name no authority record', () => {
    expect(directiveVerdict(ADDRESSEES, null, null)).toEqual({ verdict: 'authority_unknown' })
    expect(directiveVerdict([{ name: 'MA 37', territoryId: 'AT-9' }], decided(MA37, null), 'AT-9')).toEqual({ verdict: 'authority_unknown' })
  })

  it('names the addressee when the authority record has no readable name', () => {
    expect(directiveVerdict(ADDRESSEES, decided(MA37, null), 'AT-9')).toMatchObject({ verdict: 'applies', authority: 'MA 37' })
  })
})

describe('chainAt, the one walk over territory parents', () => {
  it('walks parents, then the ISO country, itself first', () => {
    const parents = new Map([['AT:gkz:60101', [{ id: 'AT-6' }]], ['AT-6', []]])
    expect(chainAt('AT:gkz:60101', '2026-11-10', (id) => parents.get(id))).toEqual(['AT:gkz:60101', 'AT-6', 'AT'])
  })

  it('follows a dated parent only inside its half-open interval: the time path sees AT in the EU, GB out of it', () => {
    const parents = new Map([
      ['AT', [{ id: 'EU', validFrom: '1995-01-01' }]],
      ['GB', [{ id: 'EU', validFrom: '1973-01-01', validTo: '2021-01-01' }]],
    ])
    const parentsOf = (id: string) => parents.get(id)
    expect(chainAt('AT-9', '2026-11-10', parentsOf)).toEqual(['AT-9', 'AT', 'EU'])
    expect(chainAt('AT-9', '1994-12-31', parentsOf)).toEqual(['AT-9', 'AT'])
    expect(chainAt('GB', '2020-12-31', parentsOf)).toEqual(['GB', 'EU'])
    expect(chainAt('GB', '2021-01-01', parentsOf)).toEqual(['GB'])
  })
})
