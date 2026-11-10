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
import { territoryChain } from './platform/territories'

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

describe('territoryChain', () => {
  it('walks parents, then the ISO country, itself first', () => {
    const parents = new Map<string, string[]>([['AT:gkz:60101', ['AT-6']], ['AT-6', []]])
    expect(territoryChain('AT:gkz:60101', parents)).toEqual(['AT:gkz:60101', 'AT-6', 'AT'])
  })
})
